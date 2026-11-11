import { getPayload, type PayloadRequest } from 'payload'

import config from '../src/payload.config'
import type { Page } from '../src/payload-types'
import { ensureMainCalendars } from '../src/collections/hooks/event-hooks'
import { ROOT_SLUG } from '../src/lib/slug'

/**
 * Seeds the local/CI database with tenants, a front page per tenant, and a district admin.
 *
 * Run with `pnpm run seed` — `payload run` gives the script the config context without
 * adding a separate TypeScript runner to the dependency surface.
 *
 * Needed because the public site is no longer static: it resolves a tenant from the request
 * Host, and an unknown host 404s by design (`02` §4.1). Without seeded tenants the dev
 * server and the e2e suite have nothing to serve.
 *
 * Pages are seeded for the same reason one step further in. `/` resolves to the top-level
 * page slugged `home` and 404s when there is none (`03` §2), so a tenant with no pages is a
 * site that answers 404 on every URL — including the one Playwright's readiness check hits.
 *
 * `*.localhost` hostnames match the local/CI environment in `06` §4. Bare `localhost` maps
 * to the district so the dev server and Playwright's readiness check resolve to a real
 * tenant.
 *
 * **Idempotent** — safe to re-run. Upserts by `slug`, the stable identifier (`03` §2),
 * rather than by hostname, which is routing configuration and may legitimately change.
 * Never truncates, so it will not wipe local content you are working on.
 */

/**
 * A minimal Lexical editor state — the shape Payload stores in a `richText` field.
 *
 * Hand-built rather than imported from a Lexical helper because the seed's job is to write
 * the same JSON an editor would, and going through the editor's own builder would test the
 * builder rather than the renderer. `src/content/rich-text.ts` maps this back out to DD2
 * nodes; anything it does not recognise is dropped, so a drift in this shape shows up as an
 * empty page rather than a crash.
 */
const text = (value: string) => ({
  type: 'text',
  text: value,
  format: 0,
  detail: 0,
  mode: 'normal',
  style: '',
  version: 1,
})

const block = (type: 'paragraph' | 'heading', value: string, tag?: 'h2' | 'h3') => ({
  type,
  ...(tag ? { tag } : {}),
  children: [text(value)],
  direction: 'ltr' as const,
  format: '' as const,
  indent: 0,
  version: 1,
})

const lexical = (blocks: ReturnType<typeof block>[]) => ({
  root: {
    type: 'root',
    children: blocks,
    direction: 'ltr' as const,
    format: '' as const,
    indent: 0,
    version: 1,
  },
})

/** A page's words, as every page holds them now (Jason, 2026-11-04): one Text section. */
const words = (blocks: ReturnType<typeof block>[]) =>
  [{ blockType: 'richText', content: lexical(blocks) }] as unknown as NonNullable<Page['layout']>

const TENANTS = [
  { name: 'DD2 District', slug: 'district', hostname: 'localhost', type: 'district' as const },
  { name: 'School A', slug: 'school-a', hostname: 'a.localhost', type: 'school' as const },
  { name: 'School B', slug: 'school-b', hostname: 'b.localhost', type: 'school' as const },
]

/**
 * Maroon and gold. The maroon is 10.9:1 on white, so it passes every pair `src/lib/theme.ts`
 * checks; the gold would fail all of them, which is the point of seeding it as the second
 * colour — it is decorative there and nothing is read against it.
 */
const THEMED_TENANT = { slug: 'school-a', primaryColor: '#7a1f2b', secondaryColor: '#c9a227' }

/**
 * Settings for the two schools and none for the district (`03` §5), so all three shapes
 * render locally and in e2e: School A has contact details and every language (its row never
 * narrows the list — the e2e locale tests run against it); School B renames itself and
 * offers Spanish only; the district has no row and gets the defaults.
 *
 * The languages here are fixtures. Which ones DD2 serves is counsel's call (`08` §10).
 */
const SETTINGS: Record<string, Record<string, unknown>> = {
  'school-a': {
    contact: {
      address: '100 School A Road\nSummerville, SC 29483',
      phone: '(843) 555-0100',
      email: 'office@a.localhost',
    },
    socialLinks: [
      { platform: 'facebook', url: 'https://www.facebook.com/' },
      { platform: 'youtube', url: 'https://www.youtube.com/' },
    ],
    defaultDescription: 'School A is a seeded school in Dorchester School District Two.',
  },
  'school-b': {
    siteTitle: 'School B Elementary',
    enabledLocales: { es: true, zhHans: false, ko: false, pt: false, ar: false },
  },
}

/**
 * The pages every seeded tenant gets, ordered parents-first.
 *
 * Deliberately NOT `/athletics`. That is the path `tests/e2e/tenant-routing.spec.ts` asserts
 * 404s, which is only a real assertion while nothing is seeded there.
 */
const PAGES = [
  {
    slug: ROOT_SLUG,
    title: 'Home',
    layout: words([
      block('paragraph', 'Welcome. This is the seeded front page for local development.'),
      block('heading', 'What is on this site', 'h2'),
      block('paragraph', 'Announcements, calendars, staff directories and school documents.'),
    ]),
  },
  {
    slug: 'about',
    title: 'About Our School',
    layout: words([block('paragraph', 'A seeded top-level page, so path walking has a target.')]),
  },
  {
    slug: 'staff',
    title: 'Staff Directory',
    /**
     * Nested on purpose. `getPageByPath` walks segments rather than reading a stored path
     * (`03` §2), and a one-segment fixture would never exercise the walk — nor prove that a
     * leading `about` is read as a path segment rather than mistaken for a locale prefix.
     */
    parentSlug: 'about',
    layout: words([block('paragraph', 'A seeded child page, reached through its parent.')]),
  },
]

/**
 * The seed writes as the district.
 *
 * `overrideAccess` is not enough on its own: it bypasses the ACCESS functions, but
 * `publishGate` is a `beforeChange` HOOK and hooks run regardless (see
 * src/collections/hooks/publish-gate.ts for why publishing is gated in both places). Without
 * a district-admin on the request, seeding a published page throws `Forbidden` — which is the
 * gate working, not a bug to route around by relaxing it.
 */
const asDistrict = {
  /**
   * Only `roles` is read, by `publishGate` and `composedPagesAreDistrictOnly`. The cast is to
   * Payload's generated `User`, whose `email`, `collection` and timestamps describe a stored
   * row — inventing values for them would make this look like an account that exists. It is
   * a request identity for the duration of the seed and is never persisted.
   */
  user: { id: 0, roles: ['district-admin'] } as unknown as PayloadRequest['user'],
}

const run = async () => {
  if (!process.env.DATABASE_URI) throw new Error('DATABASE_URI is required.')
  if (!process.env.PAYLOAD_SECRET) throw new Error('PAYLOAD_SECRET is required.')

  const payload = await getPayload({ config })

  for (const tenant of TENANTS) {
    const { docs } = await payload.find({
      collection: 'tenants',
      where: { slug: { equals: tenant.slug } },
      limit: 1,
      overrideAccess: true,
    })

    const existing = docs[0]
    if (existing) {
      await payload.update({
        collection: 'tenants',
        id: existing.id,
        data: { ...tenant, status: 'active' },
        overrideAccess: true,
      })
      payload.logger.info(`updated tenant ${tenant.slug} (${tenant.hostname})`)
    } else {
      await payload.create({
        collection: 'tenants',
        data: { ...tenant, status: 'active' },
        overrideAccess: true,
      })
      payload.logger.info(`created tenant ${tenant.slug} (${tenant.hostname})`)
    }
  }

  /** Each site's own calendar, for a site made before calendars (Jason, 2026-10-28). */
  for (const slug of await ensureMainCalendars(payload)) {
    payload.logger.info(`created the calendar for ${slug}`)
  }

  /**
   * A front page per tenant, plus a top-level page and a child of it.
   *
   * Upserted by `(tenant, slug)`. Never touches a page that already exists beyond restating
   * the seeded fields, so local content authored on top of the seed survives a re-run.
   */
  for (const tenant of TENANTS) {
    const { docs: tenantDocs } = await payload.find({
      collection: 'tenants',
      where: { slug: { equals: tenant.slug } },
      limit: 1,
      overrideAccess: true,
    })

    const tenantId = tenantDocs[0]?.id
    if (!tenantId) throw new Error(`tenant ${tenant.slug} was not created`)

    // Ids of the pages seeded for THIS tenant, so a child resolves its parent within the
    // tenant it belongs to. `PAGES` is ordered parents-first.
    const seeded = new Map<string, number>()

    for (const { parentSlug, ...page } of PAGES) {
      const { docs } = await payload.find({
        collection: 'pages',
        where: { and: [{ tenant: { equals: tenantId } }, { slug: { equals: page.slug } }] },
        limit: 1,
        depth: 0,
        overrideAccess: true,
        // Drafts are on for `pages`, so an existing unpublished row must be found and
        // republished rather than skipped and then re-created as a duplicate slug.
        draft: true,
      })

      const parent = parentSlug === undefined ? undefined : seeded.get(parentSlug)
      if (parentSlug !== undefined && parent === undefined) {
        throw new Error(`page ${page.slug} names parent ${parentSlug}, which is not seeded first`)
      }

      const data = {
        ...page,
        ...(parent === undefined ? {} : { parent }),
        tenant: tenantId,
        visibility: 'public' as const,
        _status: 'published' as const,
      }

      const existing = docs[0]
      const saved = existing
        ? await payload.update({
            collection: 'pages',
            id: existing.id,
            data,
            overrideAccess: true,
            req: asDistrict,
          })
        : await payload.create({
            collection: 'pages',
            data,
            overrideAccess: true,
            req: asDistrict,
          })

      seeded.set(page.slug, saved.id)
      payload.logger.info(`${existing ? 'updated' : 'created'} page ${tenant.slug}/${page.slug}`)
    }

    /**
     * A folder named after the site holding a "News" board (Jason, 2026-10-28), created only
     * when the site has no boards at all — a developer's own folders are never restated. Every
     * announcement needs a board, so a site without one could not post.
     */
    const { totalDocs: boards } = await payload.count({
      collection: 'post-boards',
      where: { tenant: { equals: tenantId } },
      overrideAccess: true,
    })
    if (boards === 0) {
      const folder = await payload.create({
        collection: 'post-folders',
        data: { tenant: tenantId, name: tenant.name },
        overrideAccess: true,
      })
      await payload.create({
        collection: 'post-boards',
        data: { tenant: tenantId, folder: folder.id, name: 'News' },
        overrideAccess: true,
      })
      payload.logger.info(`created the News board for ${tenant.slug}`)
    }

    /**
     * Menus (`03` §5) — one row per tenant, pointing at the pages seeded above so every link
     * resolves.
     *
     * CREATED ONLY WHEN ABSENT, where pages are upserted. A page upsert restates a few fields;
     * restating three arrays would replace whatever menu a developer had built on top of the
     * seed, and `tenant` is unique on this collection, so there is never a second row to fall
     * back to.
     */
    const { totalDocs: menus } = await payload.count({
      collection: 'navigation',
      where: { tenant: { equals: tenantId } },
      overrideAccess: true,
    })

    if (menus === 0) {
      await payload.create({
        collection: 'navigation',
        data: {
          tenant: tenantId,
          primary: [
            { label: 'About', linkType: 'address', href: '/about' },
            { label: 'Staff directory', linkType: 'address', href: '/about/staff' },
          ],
          utility: [
            {
              label: 'Staff email',
              linkType: 'address',
              href: 'https://outlook.office.com',
              newTab: true,
            },
          ],
          footer: [{ label: `About ${tenant.name}`, linkType: 'address', href: '/about' }],
        },
        overrideAccess: true,
        ...asDistrict,
      })
      payload.logger.info(`created menus for ${tenant.slug}`)
    }

    /**
     * A theme for ONE school (`03` §5), created only when absent, as the menus are. One
     * rather than all three so both render paths stay exercised locally and in e2e: School A
     * overrides the brand colour, and the district and School B render the default palette.
     */
    if (tenant.slug === THEMED_TENANT.slug) {
      const { totalDocs: themes } = await payload.count({
        collection: 'theme',
        where: { tenant: { equals: tenantId } },
        overrideAccess: true,
      })

      if (themes === 0) {
        await payload.create({
          collection: 'theme',
          data: {
            tenant: tenantId,
            primaryColor: THEMED_TENANT.primaryColor,
            secondaryColor: THEMED_TENANT.secondaryColor,
          },
          overrideAccess: true,
          ...asDistrict,
        })
        payload.logger.info(`created theme for ${tenant.slug}`)
      }
    }

    /** Settings, created only when absent, as the menus and the theme are. */
    const settings = SETTINGS[tenant.slug]
    if (settings) {
      const { totalDocs: existing } = await payload.count({
        collection: 'settings',
        where: { tenant: { equals: tenantId } },
        overrideAccess: true,
      })

      if (existing === 0) {
        await payload.create({
          collection: 'settings',
          data: { tenant: tenantId, ...settings },
          overrideAccess: true,
          ...asDistrict,
        })
        payload.logger.info(`created settings for ${tenant.slug}`)
      }
    }
  }

  /**
   * A district admin, only when one is explicitly requested via env.
   *
   * Never seeded with a default password: a known credential that ships in a repo is a
   * standing vulnerability, and interim local auth already carries enough credential risk
   * (see "Authentication" in CLAUDE.md). Without SEED_ADMIN_PASSWORD this is skipped and
   * the first user is created through Payload's own bootstrap screen at /admin.
   */
  const adminEmail = process.env.SEED_ADMIN_EMAIL
  const adminPassword = process.env.SEED_ADMIN_PASSWORD

  if (adminEmail && adminPassword) {
    const { docs } = await payload.find({
      collection: 'users',
      where: { email: { equals: adminEmail } },
      limit: 1,
      overrideAccess: true,
    })

    if (docs.length === 0) {
      await payload.create({
        collection: 'users',
        data: { email: adminEmail, password: adminPassword, roles: ['district-admin'] },
        overrideAccess: true,
      })
      payload.logger.info(`created district-admin ${adminEmail}`)
    } else {
      payload.logger.info(`district-admin ${adminEmail} already exists`)
    }
  } else {
    payload.logger.info(
      'no SEED_ADMIN_PASSWORD set — skipping admin. Create the first user at /admin.',
    )
  }

  /** The district tag list (Jason, 2026-10-28), each created only when absent. */
  for (const name of ['Elementary', 'Middle', 'High']) {
    const { totalDocs } = await payload.count({
      collection: 'post-tags',
      where: { name: { equals: name } },
      overrideAccess: true,
    })
    if (totalDocs === 0) {
      await payload.create({ collection: 'post-tags', data: { name }, overrideAccess: true })
      payload.logger.info(`created tag ${name}`)
    }
  }

  payload.logger.info('seed complete')
  process.exit(0)
}

await run()
