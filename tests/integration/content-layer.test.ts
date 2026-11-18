import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getNavigation } from '@/content/navigation'
import { getPageByPath, getPagePathById, listPagePaths } from '@/content/pages'
import { getPostBySlug, listPostPaths, listPosts } from '@/content/posts'
import { resolvePageBlocks } from '@/content/resolve-blocks'
import { getTenantByHostname, listActiveTenants } from '@/content/tenants'
import { getSettings } from '@/content/settings'
import { getTheme } from '@/content/theme'
import type { ContentContext, FeedBlock, ResolvedFeedBlock, Tenant } from '@/content/types'
import { ROOT_SLUG } from '@/lib/slug'
import type { Payload } from 'payload'

import { tinyPng } from '../helpers/files'
import { getTestPayload, seed, seedPosts, type PostFixtures } from '../helpers/payload'

/**
 * Content-access layer (`02` §11, ADR-5, `06` §2.8).
 *
 * Two things under test, and the second is the architectural one:
 *
 *  1. The functions return correct data.
 *  2. They return **DD2 domain types, not Payload documents.** That is the whole hedge —
 *     it is what makes swapping the CMS a rewrite of ~8 files rather than ~200 components.
 *     A function that leaks `createdAt`, `updatedAt`, or a Payload relationship object has
 *     silently widened the boundary, and every component that starts consuming those fields
 *     deepens the coupling.
 */

let payload: Payload
let fixtures: Awaited<ReturnType<typeof seed>>

beforeAll(async () => {
  payload = await getTestPayload()
  fixtures = await seed(payload)
}, 120_000)

describe('getTenantByHostname', () => {
  it('resolves a known host', async () => {
    const tenant = await getTenantByHostname('a.localhost')
    expect(tenant?.slug).toBe('school-a')
    expect(tenant?.type).toBe('school')
  })

  it('normalizes case, port, and trailing dot before matching', async () => {
    for (const host of ['A.LOCALHOST', 'a.localhost:3000', 'a.localhost.']) {
      expect((await getTenantByHostname(host))?.slug).toBe('school-a')
    }
  })

  it('returns null for an unknown host — never a fallback tenant', async () => {
    /**
     * `02` §4.1 — an unknown host 404s or redirects to the district. Falling back to a
     * default would serve one school's content on another school's domain, which the
     * access layer would never catch because it happens before scoping.
     */
    expect(await getTenantByHostname('unknown.example.com')).toBeNull()
    expect(await getTenantByHostname(null)).toBeNull()
    expect(await getTenantByHostname('')).toBeNull()
  })

  it('does not resolve a hidden tenant', async () => {
    const hidden = await payload.create({
      collection: 'tenants',
      data: {
        name: 'Hidden',
        slug: 'hidden',
        hostname: 'hidden.localhost',
        type: 'school',
        status: 'hidden',
      },
      overrideAccess: true,
    })

    expect(await getTenantByHostname('hidden.localhost')).toBeNull()

    await payload.delete({ collection: 'tenants', id: hidden.id, overrideAccess: true })
  })
})

describe('the boundary — domain types only', () => {
  it('returns exactly the DD2 Tenant shape, with no Payload fields leaking', async () => {
    const tenant = await getTenantByHostname('a.localhost')
    expect(tenant).not.toBeNull()

    expect(Object.keys(tenant!).sort()).toEqual(['hostname', 'id', 'name', 'slug', 'type'])

    // Explicitly assert the Payload-isms that would signal a widened boundary.
    for (const leaked of ['createdAt', 'updatedAt', '_status', 'gradesServed', 'status']) {
      expect(tenant).not.toHaveProperty(leaked)
    }
  })

  it('returns ids as strings, insulating callers from the database id type', async () => {
    // Postgres issues numeric ids. Normalizing at the boundary means a CMS or database
    // change cannot ripple into every component's prop types.
    const tenant = await getTenantByHostname('a.localhost')
    expect(typeof tenant?.id).toBe('string')
  })

  it('applies the same shape to every item from listActiveTenants', async () => {
    const tenants = await listActiveTenants()
    expect(tenants.length).toBeGreaterThanOrEqual(3)

    for (const tenant of tenants) {
      expect(Object.keys(tenant).sort()).toEqual(['hostname', 'id', 'name', 'slug', 'type'])
      expect(typeof tenant.id).toBe('string')
    }
  })

  it('excludes hidden tenants from listActiveTenants', async () => {
    const tenants = await listActiveTenants()
    expect(tenants.every((t) => t.slug !== 'hidden')).toBe(true)
  })
})

/**
 * PAGE LOOKUPS (`02` §11).
 *
 * These had no integration coverage before the tenant-root slice, which is why this block
 * covers the whole resolver rather than only the root behaviour it was added for. A
 * segment-walking resolver's failure mode is serving a NEAR MISS as a hit — one page's content
 * under another page's URL, then cached at the edge (`02` §5) — so the negative cases carry as
 * much weight as the positive ones.
 */
describe('getPageByPath', () => {
  let district: Tenant
  let ctx: ContentContext

  const mkPage = async (data: Record<string, unknown>) =>
    (
      await payload.create({
        collection: 'pages',
        data: {
          visibility: 'public',
          _status: 'published',
          ...data,
        } as never,
        user: fixtures.districtAdmin,
        overrideAccess: true,
      })
    ).id

  beforeAll(async () => {
    const resolved = await getTenantByHostname('localhost')
    if (!resolved) throw new Error('district tenant missing from the seed')
    district = resolved
    ctx = { tenant: district, locale: 'en' }

    const home = await mkPage({ tenant: district.id, title: 'Home', slug: ROOT_SLUG })
    const about = await mkPage({ tenant: district.id, title: 'About', slug: 'about' })
    await mkPage({ tenant: district.id, title: 'Staff', slug: 'staff', parent: about })
    /**
     * Children of `about`, seeded out of alphabetical order on purpose: the order the menu
     * renders in is the resolver's, not the database's insertion order.
     */
    await mkPage({
      tenant: district.id,
      title: 'Bell schedule',
      slug: 'bell-schedule',
      parent: about,
    })
    await mkPage({
      tenant: district.id,
      title: 'Unfinished',
      slug: 'unfinished',
      parent: about,
      _status: 'draft',
    })
    await mkPage({
      tenant: district.id,
      title: 'Internal note',
      slug: 'internal-note',
      parent: about,
      visibility: 'staff',
    })
    /**
     * Hidden from navigation (Jason, 2026-10-29): reachable by its address, absent from its
     * parent's section menu. A child of `about`, so the menu assertions above prove it.
     */
    await mkPage({
      tenant: district.id,
      title: 'Quiet corner',
      slug: 'quiet-corner',
      parent: about,
      hideFromNavigation: true,
    })
    // Hidden from search engines: an ordinary page in every other way.
    await mkPage({
      tenant: district.id,
      title: 'Not in results',
      slug: 'not-in-results',
      hideFromSearchEngines: true,
    })
    // Hidden from the site's own search (Jason, 2026-11-11) — which Phase 6 builds.
    await mkPage({
      tenant: district.id,
      title: 'Not in site search',
      slug: 'not-in-site-search',
      hideFromSiteSearch: true,
    })
    await mkPage({ tenant: district.id, title: 'Draft', slug: 'draft-only', _status: 'draft' })
    await mkPage({
      tenant: district.id,
      title: 'Staff only',
      slug: 'internal',
      visibility: 'staff',
    })

    /**
     * A page nested under the front page. It should never exist — `rootPageCannotBeParent`
     * refuses it — so it is written through the DATABASE ADAPTER, under the hooks, to prove
     * the RESOLVER is safe even when the data is not.
     *
     * `overrideAccess` would not do it: Payload runs hooks regardless, which is the point of
     * putting the guard in one. Going under them is also the honest simulation, because a
     * migration or a direct database write is exactly how this row could appear in production
     * — validation and resolution are separate guarantees, and only one of them survives that.
     */
    const orphan = await mkPage({ tenant: district.id, title: 'Orphan', slug: 'orphan' })
    await payload.db.updateOne({
      collection: 'pages',
      id: orphan,
      data: { parent: home },
    })
  }, 120_000)

  it('resolves the bare root path to the top-level home page', () => {
    return expect(getPageByPath(ctx, '/')).resolves.toMatchObject({
      slug: ROOT_SLUG,
      path: '/',
    })
  })

  it('reports the front page at "/" rather than at its slug', async () => {
    // The path is what templates, canonicals and hreflang all read (`08` §5).
    expect((await getPageByPath(ctx, '/'))?.path).toBe('/')
  })

  it('refuses /home, so the front page has exactly one URL', async () => {
    /**
     * Both URLs resolving would be duplicate content and two CDN cache entries for one page.
     * Refusing rather than redirecting keeps the resolver a pure lookup; a redirect is a
     * routing concern if DD2 ever wants one.
     */
    expect(await getPageByPath(ctx, '/home')).toBeNull()
  })

  it('does not resolve a page nested under the front page', async () => {
    // Its path would be `/home/orphan`, and `/home` is refused. It has no reachable URL.
    expect(await getPageByPath(ctx, '/home/orphan')).toBeNull()
    expect(await getPageByPath(ctx, '/orphan')).toBeNull()
  })

  it('resolves a top-level page and a nested one', async () => {
    expect((await getPageByPath(ctx, '/about'))?.slug).toBe('about')
    expect((await getPageByPath(ctx, '/about/staff'))?.path).toBe('/about/staff')
  })

  it('never serves a near miss as a hit', async () => {
    /**
     * The failure this resolver exists to avoid. `staff` is real, but only under `about` — as
     * a top-level path it must 404 rather than falling back to the child, and a path with a
     * missing middle segment must not skip it.
     */
    expect(await getPageByPath(ctx, '/staff')).toBeNull()
    expect(await getPageByPath(ctx, '/missing/staff')).toBeNull()
    expect(await getPageByPath(ctx, '/about/staff/deeper')).toBeNull()
  })

  it('does not resolve drafts or staff-only pages', async () => {
    // The public filter lives in this file, not in an access function — see `publishedAndPublic`.
    expect(await getPageByPath(ctx, '/draft-only')).toBeNull()
    expect(await getPageByPath(ctx, '/internal')).toBeNull()
  })

  it('does not resolve another tenant’s page', async () => {
    const other = await getTenantByHostname('a.localhost')
    if (!other) throw new Error('school-a missing from the seed')

    expect(await getPageByPath({ tenant: other, locale: 'en' }, '/about')).toBeNull()
  })

  it('distinguishes "no path given" from the root path', async () => {
    /**
     * `/` and `''` are requests for the front page. `null` and `undefined` are nothing being
     * asked for at all, and answering those with the front page would let a caller's missing
     * argument look like a successful lookup.
     */
    expect((await getPageByPath(ctx, ''))?.slug).toBe(ROOT_SLUG)
    expect(await getPageByPath(ctx, null)).toBeNull()
    expect(await getPageByPath(ctx, undefined)).toBeNull()
  })

  /**
   * THE PAGE'S OWN TREE (`03` §3.3, decided 2026-08-28).
   *
   * `ChildPageNav` renders the pages beneath the current one, and `src/blocks/` may not import
   * the Payload SDK (CLAUDE.md rule 1) — so the children arrive as part of the page rather
   * than being fetched by the block. That makes this the resolver's job, and these are its
   * tests.
   *
   * The rule the whole set turns on: **a child appears here only if it has a reachable URL.**
   * A menu entry that 404s is worse than a missing one, and it would be cached (`02` §5).
   */
  describe('the page tree', () => {
    it('lists a page’s published, public children in title order', async () => {
      const page = await getPageByPath(ctx, '/about')

      expect(page?.children).toEqual([
        { id: expect.any(String), title: 'Bell schedule', path: '/about/bell-schedule' },
        { id: expect.any(String), title: 'Staff', path: '/about/staff' },
      ])
    })

    /**
     * The same filter the resolver applies to the page itself. A draft child in a menu would
     * publish its title and its URL — enough to leak that unannounced content exists, and
     * enough for the link to 404 (`03` §6.4).
     */
    it('omits draft and staff-only children', async () => {
      const titles = (await getPageByPath(ctx, '/about'))?.children.map((child) => child.title)

      expect(titles).not.toContain('Unfinished')
      expect(titles).not.toContain('Internal note')
    })

    it('gives a leaf page an empty tree rather than omitting the field', async () => {
      expect((await getPageByPath(ctx, '/about/staff'))?.children).toEqual([])
    })

    /**
     * The front page's children have no reachable URL — their path would start `/home/`, which
     * `getPageByPath` refuses so the front page has exactly one URL. `rootPageCannotBeParent`
     * refuses this shape on write and the `orphan` fixture was written under the hooks anyway,
     * because validation and resolution are separate guarantees.
     */
    it('gives the front page no children, even when a row points at it', async () => {
      expect((await getPageByPath(ctx, '/'))?.children).toEqual([])
    })

    /** Every path the menu will render has to resolve, or the menu links into a 404. */
    it('emits child paths that resolve', async () => {
      const children = (await getPageByPath(ctx, '/about'))?.children ?? []
      expect(children).not.toHaveLength(0)

      for (const child of children) {
        expect(await getPageByPath(ctx, child.path), `child path ${child.path}`).not.toBeNull()
      }
    })

    /**
     * The build path and the request path must agree. `listPagePaths` assembles children in
     * memory from the tenant-wide query it already runs — it must not answer differently from
     * the resolver, which asks the database.
     */
    it('agrees with listPagePaths on the same page’s children', async () => {
      const entry = (await listPagePaths(ctx)).find((item) => item.path === '/about')
      const resolved = await getPageByPath(ctx, '/about')

      expect(entry?.page.children).toEqual(resolved?.children)
    })

    /** The boundary again: a child is a link, not a leaked Payload document. */
    it('returns link shapes only, with no Payload fields', async () => {
      const [child] = (await getPageByPath(ctx, '/about'))?.children ?? []
      expect(Object.keys(child ?? {}).sort()).toEqual(['id', 'path', 'title'])
    })
  })

  describe('listPagePaths', () => {
    it('lists the front page at "/" and never at its slug', async () => {
      const paths = (await listPagePaths(ctx)).map((entry) => entry.path)

      expect(paths).toContain('/')
      expect(paths).not.toContain('/home')
    })

    it('skips a page nested under the front page', async () => {
      /**
       * Every path here becomes a static param, so a path this list emits and
       * `getPageByPath` refuses would build a route that 404s at request time.
       */
      const paths = (await listPagePaths(ctx)).map((entry) => entry.path)

      expect(paths).not.toContain('/home/orphan')
      expect(paths).not.toContain('/orphan')
    })

    it('agrees with getPageByPath on every path it emits', async () => {
      // The invariant that keeps the build and the resolver from disagreeing.
      for (const { path } of await listPagePaths(ctx)) {
        expect(await getPageByPath(ctx, path), `listPagePaths emitted ${path}`).not.toBeNull()
      }
    })

    it('omits drafts and staff-only pages', async () => {
      const paths = (await listPagePaths(ctx)).map((entry) => entry.path)

      expect(paths).not.toContain('/draft-only')
      expect(paths).not.toContain('/internal')
    })

    it('leaves a page hidden from navigation out of its parent’s menu here too', async () => {
      const about = (await listPagePaths(ctx)).find(({ path }) => path === '/about')
      expect(about?.page.children.map((child) => child.title)).toEqual(['Bell schedule', 'Staff'])
    })
  })

  describe('hidden pages (Jason, 2026-10-29)', () => {
    it('serves a page hidden from navigation at its address', async () => {
      const page = await getPageByPath(ctx, '/about/quiet-corner')
      expect(page?.title).toBe('Quiet corner')
      // Built too — hidden from menus is not hidden from the site.
      const paths = (await listPagePaths(ctx)).map((entry) => entry.path)
      expect(paths).toContain('/about/quiet-corner')
    })

    it('says which pages are hidden from search engines', async () => {
      expect((await getPageByPath(ctx, '/not-in-results'))?.hideFromSearchEngines).toBe(true)
      expect((await getPageByPath(ctx, '/about'))?.hideFromSearchEngines).toBe(false)
    })

    it("says which pages are hidden from the site's own search", async () => {
      const hidden = await getPageByPath(ctx, '/not-in-site-search')
      expect(hidden?.hideFromSiteSearch).toBe(true)
      // The two hide options are separate: hiding from one does not hide from the other.
      expect(hidden?.hideFromSearchEngines).toBe(false)
      expect((await getPageByPath(ctx, '/not-in-results'))?.hideFromSiteSearch).toBe(false)
    })
  })
})

describe('getNavigation', () => {
  const ctxFor = async (hostname: string): Promise<ContentContext> => {
    const tenant = await getTenantByHostname(hostname)
    if (!tenant) throw new Error(`fixture tenant ${hostname} did not resolve`)
    return { tenant, locale: 'en' }
  }

  it("returns the resolved tenant's menus", async () => {
    const nav = await getNavigation(await ctxFor('a.localhost'))

    expect(nav.primary.map((link) => link.label)).toEqual(['About School A', 'Calendar'])
    expect(nav.utility[0]).toMatchObject({ href: 'https://outlook.office.com', newTab: true })
    expect(nav.footer.map((link) => link.label)).toEqual(['Contact School A'])
  })

  it("never returns another tenant's menus", async () => {
    /**
     * Access is overridden on this path, so the tenant filter in the query is the ONLY thing
     * keeping School B's links off School A's header (`02` §4.2).
     */
    const nav = await getNavigation(await ctxFor('a.localhost'))
    expect(JSON.stringify(nav)).not.toContain('School B')
  })

  it('returns empty menus for a tenant with no navigation row — never null, never a neighbour', async () => {
    // The seeded district has no row.
    const nav = await getNavigation(await ctxFor('localhost'))
    expect(nav).toEqual({ primary: [], utility: [], footer: [] })
  })

  it('returns DD2 menu links, not Payload rows', async () => {
    const nav = await getNavigation(await ctxFor('a.localhost'))
    expect(Object.keys(nav).sort()).toEqual(['footer', 'primary', 'utility'])
    for (const link of [...nav.primary, ...nav.utility, ...nav.footer]) {
      expect(Object.keys(link).sort()).toEqual(['href', 'id', 'label', 'newTab'])
    }
  })
})

describe('getTheme', () => {
  const tenantFor = async (hostname: string) => {
    const tenant = await getTenantByHostname(hostname)
    if (!tenant) throw new Error(`fixture tenant ${hostname} did not resolve`)
    return { tenant }
  }

  it("returns the resolved tenant's overrides, as custom properties", async () => {
    expect(await getTheme(await tenantFor('a.localhost'))).toEqual({
      tokens: { '--color-brand': '#7a1f2b', '--color-accent': '#c9a227' },
    })
  })

  it("never returns another tenant's color", async () => {
    // Access is overridden on this path; the tenant filter is the only scoping (`02` §4.2).
    expect(await getTheme(await tenantFor('b.localhost'))).toEqual({
      tokens: { '--color-brand': '#14532d' },
    })
  })

  it('returns no overrides for a tenant with no theme row', async () => {
    expect(await getTheme(await tenantFor('localhost'))).toEqual({ tokens: {} })
  })

  it('returns no overrides for a failing palette that reached the database anyway', async () => {
    /**
     * The route the validator does not cover: a direct write. `07` §3's guarantee has to
     * hold for what is SERVED, so the render path re-checks rather than trusting the row.
     */
    await payload.db.drizzle.execute(
      `update theme set primary_color = '#ffcc00' where tenant_id = ${String(fixtures.tenantA)}`,
    )

    expect(await getTheme(await tenantFor('a.localhost'))).toEqual({ tokens: {} })
  })
})

describe('getSettings', () => {
  const tenantFor = async (hostname: string) => {
    const tenant = await getTenantByHostname(hostname)
    if (!tenant) throw new Error(`fixture tenant ${hostname} did not resolve`)
    return { tenant }
  }

  it("returns the resolved tenant's settings, as DD2 types", async () => {
    expect(await getSettings(await tenantFor('a.localhost'))).toEqual({
      siteTitle: 'Alpha School',
      contact: {
        // A row with the one-box address of before the split: read line by line (2026-11-18).
        address: ['1 Alpha Road', 'Summerville, SC 29483'],
        phone: { text: '(843) 555-0101', href: 'tel:8435550101' },
        fax: null,
        email: null,
      },
      social: [
        {
          id: expect.any(String),
          platform: 'facebook',
          label: 'Facebook',
          href: 'https://www.facebook.com/Alpha',
        },
      ],
      defaultDescription: 'About Alpha.',
      // The row still stores Spanish and Arabic; every site is English only (Jason, 2026-11-18).
      enabledLocales: ['en'],
      logo: null,
      secondaryLogo: null,
      primaryThumbnail: null,
      secondaryThumbnail: null,
    })
  })

  it("never returns another tenant's settings", async () => {
    // Access is overridden on this path; the tenant filter is the only scoping (`02` §4.2).
    const settings = await getSettings(await tenantFor('b.localhost'))
    expect(settings.siteTitle).toBe('Bravo School')
    expect(settings.contact.phone?.href).toBe('tel:8435550202')
  })

  it('the address in parts, a fax, and a thumbnail, through the database (Jason, 2026-11-18)', async () => {
    const { tenant } = await tenantFor('b.localhost')
    const image = await payload.create({
      collection: 'resources',
      data: {
        tenant: Number(tenant.id),
        title: 'School front',
        alt: 'The front of Bravo School',
      } as never,
      file: await tinyPng(120, 63),
      overrideAccess: true,
    })
    const row = (
      await payload.find({
        collection: 'settings',
        where: { tenant: { equals: Number(tenant.id) } },
        limit: 1,
        overrideAccess: true,
      })
    ).docs[0]!
    const before = { contact: row.contact, primaryThumbnail: row.primaryThumbnail ?? null }
    await payload.update({
      collection: 'settings',
      id: row.id,
      data: {
        contact: {
          ...row.contact,
          street: '2 Bravo Road',
          city: 'Summerville',
          state: 'sc',
          zip: '29483',
          fax: '843.555.0299',
        },
        primaryThumbnail: image.id,
      } as never,
      overrideAccess: true,
    })
    try {
      const settings = await getSettings({ tenant })
      expect(settings.contact.address).toEqual(['2 Bravo Road', 'Summerville, SC 29483'])
      expect(settings.contact.fax).toBe('843.555.0299')
      expect(settings.primaryThumbnail).toMatchObject({
        alt: 'The front of Bravo School',
        width: 120,
        height: 63,
      })
      expect(settings.primaryThumbnail?.src).toMatch(/\.png$/)
    } finally {
      await payload.update({
        collection: 'settings',
        id: row.id,
        data: before as never,
        overrideAccess: true,
      })
      await payload.delete({ collection: 'resources', id: image.id, overrideAccess: true })
    }
  })

  it('returns the defaults for a tenant with no settings row — English only', async () => {
    expect(await getSettings(await tenantFor('localhost'))).toEqual({
      siteTitle: null,
      contact: { address: [], phone: null, fax: null, email: null },
      social: [],
      defaultDescription: null,
      enabledLocales: ['en'],
      logo: null,
      secondaryLogo: null,
      primaryThumbnail: null,
      secondaryThumbnail: null,
    })
  })
})

describe('page SEO fields (`03` §2, plugin-seo)', () => {
  const ctxA = async (): Promise<ContentContext> => {
    const tenant = await getTenantByHostname('a.localhost')
    if (!tenant) throw new Error('fixture tenant a.localhost did not resolve')
    return { tenant, locale: 'en' }
  }

  it('are null on a page nobody wrote them for — the usual case, not an error', async () => {
    const page = await getPageByPath(await ctxA(), '/published-page-a')
    expect(page?.seo).toEqual({ title: null, description: null })
  })

  it("surface the plugin's `meta` group as the domain's `seo`, and nothing else of it", async () => {
    await payload.update({
      collection: 'pages',
      id: fixtures.publishedPageA,
      data: { meta: { title: '  Meet School A ', description: 'Written by a person.' } },
      user: fixtures.districtAdmin,
      overrideAccess: true,
    })

    const page = await getPageByPath(await ctxA(), '/published-page-a')
    expect(page?.seo).toEqual({ title: 'Meet School A', description: 'Written by a person.' })
    // The Payload-side name must not cross the boundary (`02` §11).
    expect(page && 'meta' in page).toBe(false)

    const listed = (await listPagePaths(await ctxA())).find(
      ({ path }) => path === '/published-page-a',
    )
    expect(listed?.page.seo).toEqual(page?.seo)
  })

  it('treats a whitespace-only value as none', async () => {
    await payload.update({
      collection: 'pages',
      id: fixtures.publishedPageA,
      data: { meta: { title: '   ', description: '' } },
      user: fixtures.districtAdmin,
      overrideAccess: true,
    })

    expect((await getPageByPath(await ctxA(), '/published-page-a'))?.seo).toEqual({
      title: null,
      description: null,
    })
  })
})

/**
 * Announcements on the public site (Jason, 2026-10-28): `/news/{slug}` on the HOME site only;
 * a shared one is listed elsewhere and links home.
 */
describe('posts on the public site', () => {
  let p: PostFixtures
  const ctxFor = async (hostname: string): Promise<ContentContext> => ({
    tenant: (await getTenantByHostname(hostname))!,
    locale: 'en',
  })

  beforeAll(async () => {
    p = await seedPosts(payload, fixtures)
  })

  it('getPostBySlug finds a published, public post on its own site', async () => {
    const post = await getPostBySlug(await ctxFor('a.localhost'), 'published-post-a')
    expect(post?.id).toBe(String(p.publishedPostA))
    expect(post?.homeHostname).toBe('a.localhost')
  })

  it.each([
    ['a draft', 'a.localhost', 'draft-post-a'],
    ['a staff-only post', 'a.localhost', 'staff-post-a'],
    ['another school’s post', 'a.localhost', 'published-post-b'],
    // Shared with B, but its address is on the district site — one URL per announcement.
    ['a post shared here from elsewhere', 'b.localhost', 'district-wide-post'],
    ['nothing', 'a.localhost', 'no-such-post'],
  ])('getPostBySlug finds no page for %s', async (_label, host, slug) => {
    expect(await getPostBySlug(await ctxFor(host), slug)).toBeNull()
  })

  it('listPosts names each post’s home site, so a shared one can link there', async () => {
    const posts = await listPosts(await ctxFor('b.localhost'), { limit: 100 })
    const shared = posts.find((x) => x.id === String(p.districtWidePost))
    expect(shared?.homeHostname).toBe('localhost')
    expect(posts.find((x) => x.id === String(p.publishedPostB))?.homeHostname).toBe('b.localhost')
  })

  /** Featured until (Jason, 2026-11-04): first in lists until then, whatever its date. */
  it('listPosts puts a featured post first, and back in date order once its time passes', async () => {
    const ctx = await ctxFor('a.localhost')
    const hour = 60 * 60 * 1000
    // Straight to the live row: a time already past is not something the form would accept.
    const feature = (id: number, until: string) =>
      payload.db.updateOne({
        collection: 'posts',
        where: { id: { equals: id } },
        data: { featuredUntil: until },
      })
    const older = await payload.create({
      collection: 'posts',
      data: {
        tenant: fixtures.tenantA,
        board: fixtures.boardA,
        title: 'Older but featured',
        body: {
          root: {
            type: 'root',
            children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Featured.' }] }],
          },
        },
        slug: `older-featured-${Date.now()}`,
        visibility: 'public',
        publishedDate: new Date(Date.now() - 400 * 24 * hour).toISOString(),
        _status: 'published',
      } as never,
      user: fixtures.districtAdmin,
      overrideAccess: true,
    })
    try {
      await feature(older.id as number, new Date(Date.now() + 24 * hour).toISOString())
      expect((await listPosts(ctx, { limit: 3 }))[0]?.id).toBe(String(older.id))

      await feature(older.id as number, new Date(Date.now() - hour).toISOString())
      const ids = (await listPosts(ctx, { limit: 100 })).map((post) => post.id)
      expect(ids[0]).not.toBe(String(older.id))
      expect(ids).toContain(String(older.id))
    } finally {
      await payload.delete({ collection: 'posts', id: older.id, overrideAccess: true })
    }
  })

  it('listPostPaths is the site’s OWN published, public posts — what its sitemap names', async () => {
    const paths = await listPostPaths(await ctxFor('a.localhost'))
    expect(paths).toContain('/news/published-post-a')
    for (const slug of ['draft-post-a', 'staff-post-a', 'published-post-b', 'district-wide-post']) {
      expect(paths).not.toContain(`/news/${slug}`)
    }
  })
})

describe('/news belongs to announcements', () => {
  const page = (slug: string, parent?: number) =>
    payload.create({
      collection: 'pages',
      data: {
        tenant: fixtures.tenantA,
        title: slug,
        slug,
        visibility: 'public',
        ...(parent === undefined ? {} : { parent }),
      },
      draft: true,
      overrideAccess: true,
    })

  it('a top-level page cannot take the address "news"', async () => {
    await expect(page('news')).rejects.toThrow()
  })

  it('a page called "news" under another page is an ordinary page', async () => {
    const created = await page('news', fixtures.publishedPageA)
    expect(created.slug).toBe('news')
  })
})

/**
 * The resolve pass (Jason, 2026-10-28): stored block settings in, ready-to-render blocks out.
 * Data blocks are filled here because a block never fetches (CLAUDE.md rule 1).
 */
describe('resolvePageBlocks', () => {
  let p: PostFixtures
  const ctxFor = async (hostname: string): Promise<ContentContext> => ({
    tenant: (await getTenantByHostname(hostname))!,
    locale: 'en',
  })
  const feed = (boards: number[], extra: Partial<FeedBlock> = {}): FeedBlock => ({
    kind: 'feed',
    id: 'feed-1',
    heading: 'District news',
    boards: boards.map(String),
    tags: [],
    limit: 5,
    ...extra,
  })

  beforeAll(async () => {
    p = await seedPosts(payload, fixtures)
  })

  it('fills a feed with ready items — and only what reaches this site', async () => {
    const [block] = await resolvePageBlocks(
      await ctxFor('b.localhost'),
      [feed([fixtures.boardDistrict])],
      { serverUrl: 'http://localhost:3000' },
    )
    expect(block).toMatchObject({
      kind: 'feed',
      id: 'feed-1',
      heading: 'District news',
      moreHref: '/news',
    })
    const titles = (block as ResolvedFeedBlock).items.map((i) => i.title)
    expect(titles).toContain('district wide post')
    expect(titles).not.toContain('district wide draft')
    // Shared with B, filed on the district's board, linked to its home site.
    const item = (block as ResolvedFeedBlock).items.find((i) => i.title === 'district wide post')
    // `-2` and on when another block in this file seeded the same fixtures first.
    expect(item?.href).toMatch(/^http:\/\/localhost:3000\/news\/district-wide-post(-\d+)?$/)
    expect(p.districtWidePost).toBeGreaterThan(0)
  })

  /** Columns (Jason, 2026-11-04): a feed in a column is filled as one on the page is. */
  it('fills a feed inside a column, and leaves the column’s other blocks as they are', async () => {
    const [block] = await resolvePageBlocks(
      await ctxFor('b.localhost'),
      [
        {
          kind: 'columns',
          id: 'cols-1',
          heading: null,
          columns: [
            { heading: 'News', blocks: [feed([fixtures.boardDistrict])] },
            { heading: null, blocks: [{ kind: 'divider', id: 'd' }] },
          ],
        },
      ],
      { serverUrl: 'http://localhost:3000' },
    )
    expect(block?.kind).toBe('columns')
    const columns = block?.kind === 'columns' ? block.columns : []
    const [inFeed] = columns[0]?.blocks ?? []
    expect(inFeed?.kind).toBe('feed')
    expect((inFeed as ResolvedFeedBlock).items.map((i) => i.title)).toContain('district wide post')
    expect(columns[1]?.blocks).toEqual([{ kind: 'divider', id: 'd' }])
  })

  it('honours the count', async () => {
    const [block] = await resolvePageBlocks(
      await ctxFor('b.localhost'),
      [feed([fixtures.boardDistrict, fixtures.boardB], { limit: 1 })],
      { serverUrl: '' },
    )
    expect((block as ResolvedFeedBlock).items).toHaveLength(1)
  })

  it('DROPS a feed with nothing to show — no heading over an empty box', async () => {
    // School A's board seen from School B: nothing of A's is shared with B.
    expect(
      await resolvePageBlocks(await ctxFor('b.localhost'), [feed([fixtures.boardA])], {
        serverUrl: '',
      }),
    ).toEqual([])
  })

  it('passes every other block through untouched, in order', async () => {
    const divider = { kind: 'divider' as const, id: 'd' }
    const nav = { kind: 'childPageNav' as const, id: 'n', heading: null }
    expect(
      await resolvePageBlocks(await ctxFor('a.localhost'), [divider, nav], { serverUrl: '' }),
    ).toEqual([divider, nav])
  })
})

/**
 * Permalinks and menu links to a page (Jason, 2026-10-29): both resolve a page id to the path
 * the page has today, through the tenant's published, public pages only.
 */
describe('getPagePathById', () => {
  const ctxFor = async (hostname: string): Promise<ContentContext> => {
    const tenant = await getTenantByHostname(hostname)
    if (!tenant) throw new Error(`fixture tenant ${hostname} did not resolve`)
    return { tenant, locale: 'en' }
  }

  it("returns a published page's current path", async () => {
    const path = await getPagePathById(await ctxFor('a.localhost'), String(fixtures.publishedPageA))
    expect(path).toBe('/published-page-a')
  })

  it('follows a move — the path is the one the page has now', async () => {
    const ctx = await ctxFor('a.localhost')
    const parent = await payload.create({
      collection: 'pages',
      data: {
        tenant: fixtures.tenantA,
        title: 'Moved under',
        slug: 'moved-under',
        visibility: 'public',
        _status: 'published',
      },
      user: fixtures.districtAdmin,
      overrideAccess: true,
    })
    const child = await payload.create({
      collection: 'pages',
      data: {
        tenant: fixtures.tenantA,
        title: 'Wanders',
        slug: 'wanders',
        visibility: 'public',
        _status: 'published',
      },
      user: fixtures.districtAdmin,
      overrideAccess: true,
    })
    expect(await getPagePathById(ctx, String(child.id))).toBe('/wanders')

    await payload.update({
      collection: 'pages',
      id: child.id,
      data: { parent: parent.id, slug: 'wandered', _status: 'published' },
      user: fixtures.districtAdmin,
      overrideAccess: true,
    })
    expect(await getPagePathById(ctx, String(child.id))).toBe('/moved-under/wandered')

    await payload.delete({ collection: 'pages', id: child.id, overrideAccess: true })
    await payload.delete({ collection: 'pages', id: parent.id, overrideAccess: true })
  })

  it('returns null for a draft or a staff-only page', async () => {
    const ctx = await ctxFor('a.localhost')
    expect(await getPagePathById(ctx, String(fixtures.draftPageA))).toBeNull()
    expect(await getPagePathById(ctx, String(fixtures.staffPageA))).toBeNull()
  })

  it("never resolves another site's page", async () => {
    /**
     * Access is overridden on this path; the tenant clause is the only thing keeping
     * `/dd2/pages/<B's id>` on School A's host from redirecting into School B (`02` §4.2).
     */
    expect(
      await getPagePathById(await ctxFor('a.localhost'), String(fixtures.publishedPageB)),
    ).toBeNull()
  })

  it('returns null for an id that is no page', async () => {
    expect(await getPagePathById(await ctxFor('a.localhost'), '999999999')).toBeNull()
  })
})

describe('getNavigation — links to a page', () => {
  const ctxFor = async (hostname: string): Promise<ContentContext> => {
    const tenant = await getTenantByHostname(hostname)
    if (!tenant) throw new Error(`fixture tenant ${hostname} did not resolve`)
    return { tenant, locale: 'en' }
  }

  it("uses the page's path, and drops links to pages that are not live on this site", async () => {
    const original = await payload.findByID({
      collection: 'navigation',
      id: fixtures.navigationA,
      depth: 0,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'navigation',
      id: fixtures.navigationA,
      data: {
        primary: [
          { label: 'Live', linkType: 'page', page: fixtures.publishedPageA },
          { label: 'Draft', linkType: 'page', page: fixtures.draftPageA },
          { label: 'Staff', linkType: 'page', page: fixtures.staffPageA },
        ],
      },
      overrideAccess: true,
    })

    try {
      const nav = await getNavigation(await ctxFor('a.localhost'))
      expect(nav.primary.map((l) => [l.label, l.href])).toEqual([['Live', '/published-page-a']])
    } finally {
      await payload.update({
        collection: 'navigation',
        id: fixtures.navigationA,
        data: { primary: original.primary ?? [] },
        overrideAccess: true,
      })
    }
  })

  it("refuses a menu link to another site's page", async () => {
    await expect(
      payload.update({
        collection: 'navigation',
        id: fixtures.navigationA,
        data: {
          primary: [{ label: 'Elsewhere', linkType: 'page', page: fixtures.publishedPageB }],
        },
        user: fixtures.districtAdmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})

/**
 * Buttons, cards and the words linking to a page (Jason, 2026-10-29) take the page's path
 * today, through the same tenant-scoped path index as permalinks and menus.
 */
describe('links to a page in the words and the blocks', () => {
  const ctxFor = async (hostname: string): Promise<ContentContext> => ({
    tenant: (await getTenantByHostname(hostname))!,
    locale: 'en',
  })
  const wordsLinkingTo = (page: number) => ({
    root: {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              version: 3,
              fields: { linkType: 'internal', doc: { relationTo: 'pages', value: page } },
              children: [{ type: 'text', text: 'See this', format: 0, version: 1 }],
            },
          ],
        },
      ],
    },
  })

  it('resolves them on the page — by path and in the build list alike', async () => {
    const made = await payload.create({
      collection: 'pages',
      data: {
        tenant: fixtures.tenantA,
        title: 'Links out',
        slug: 'links-out',
        visibility: 'public',
        layout: [
          { blockType: 'richText', content: wordsLinkingTo(fixtures.publishedPageA) as never },
          {
            blockType: 'callToAction',
            heading: 'Go',
            linkLabel: 'Go there',
            linkType: 'page',
            page: fixtures.publishedPageA,
          },
          {
            blockType: 'callToAction',
            heading: 'Draft',
            linkLabel: 'Go nowhere',
            linkType: 'page',
            page: fixtures.draftPageA,
          },
        ],
        _status: 'published',
      },
      user: fixtures.districtAdmin,
      overrideAccess: true,
    })

    try {
      const ctx = await ctxFor('a.localhost')
      const byPath = await getPageByPath(ctx, '/links-out')
      const built = (await listPagePaths(ctx)).find(({ path }) => path === '/links-out')?.page

      for (const page of [byPath, built]) {
        // The words are a Text section now (every page composed, Jason 2026-11-04), on top.
        expect(JSON.stringify(page?.layout[0])).toContain('"href":"/published-page-a"')
        // The draft's button goes nowhere, so it is not on the page at all.
        expect(page?.layout.map((b) => (b.kind === 'callToAction' ? b.href : b.kind))).toEqual([
          'richText',
          '/published-page-a',
        ])
      }
    } finally {
      await payload.delete({ collection: 'pages', id: made.id, overrideAccess: true })
    }
  })

  it("refuses a button that links to another site's page", async () => {
    // Payload's message names the field; the reason is in its details.
    const refusal = await payload
      .create({
        collection: 'pages',
        data: {
          tenant: fixtures.tenantA,
          title: 'Links away',
          slug: 'links-away',
          visibility: 'public',
          layout: [
            {
              blockType: 'callToAction',
              heading: 'Elsewhere',
              linkLabel: 'Go to B',
              linkType: 'page',
              page: fixtures.publishedPageB,
            },
          ],
          _status: 'draft',
        },
        user: fixtures.districtAdmin,
        overrideAccess: false,
      })
      .then(
        () => null,
        (err: { data?: unknown }) => err,
      )
    expect(JSON.stringify(refusal?.data)).toMatch(/this site/)
  })

  it('resolves them in an announcement, on its home site', async () => {
    const p = await seedPosts(payload, fixtures)
    await payload.update({
      collection: 'posts',
      id: p.publishedPostA,
      // Its own slug: every `seedPosts` call makes another `published-post-a`.
      data: {
        slug: 'links-to-a-page',
        body: wordsLinkingTo(fixtures.publishedPageA) as never,
        _status: 'published',
      },
      user: fixtures.districtAdmin,
      overrideAccess: true,
    })
    const post = await getPostBySlug(await ctxFor('a.localhost'), 'links-to-a-page')
    expect(JSON.stringify(post?.body)).toContain('"href":"/published-page-a"')
  })
})

/**
 * Linked pages, internal redirect (Jason, 2026-10-29). The content layer says where a linked
 * page sends visitors — a page on its own site, or a district page — and treats one whose
 * target is not live as no page at all, so it 404s and leaves the menus.
 */
describe('linked pages — internal redirect', () => {
  const ctxFor = async (hostname: string): Promise<ContentContext> => ({
    tenant: (await getTenantByHostname(hostname))!,
    locale: 'en',
  })
  const made: (string | number)[] = []
  const mk = async (data: Record<string, unknown>) => {
    const doc = await payload.create({
      collection: 'pages',
      data: { visibility: 'public', _status: 'published', ...data } as never,
      user: fixtures.districtAdmin,
      overrideAccess: true,
    })
    made.push(doc.id)
    return doc.id
  }
  let districtPage: string | number
  let draftDistrictPage: string | number

  beforeAll(async () => {
    districtPage = await mk({
      tenant: fixtures.districtTenant,
      title: 'Enroll',
      slug: 'linked-enroll',
    })
    draftDistrictPage = await mk({
      tenant: fixtures.districtTenant,
      title: 'Not yet',
      slug: 'linked-not-yet',
      _status: 'draft',
    })
  })
  afterAll(async () => {
    for (const id of made.reverse()) {
      await payload.delete({ collection: 'pages', id, overrideAccess: true }).catch(() => null)
    }
  })

  it('sends visitors to a page on its own site', async () => {
    await mk({
      tenant: fixtures.tenantA,
      title: 'Go home',
      slug: 'linked-go-home',
      linkMode: 'redirect',
      linkTo: 'site',
      linkTarget: fixtures.publishedPageA,
    })
    const page = await getPageByPath(await ctxFor('a.localhost'), '/linked-go-home')
    expect(page?.redirect).toEqual({ path: '/published-page-a', hostname: 'a.localhost' })
  })

  it('sends visitors to a district page', async () => {
    await mk({
      tenant: fixtures.tenantA,
      title: 'Enrollment',
      slug: 'linked-enrollment',
      linkMode: 'redirect',
      linkTo: 'district',
      districtLinkTarget: districtPage,
    })
    const ctx = await ctxFor('a.localhost')
    expect((await getPageByPath(ctx, '/linked-enrollment'))?.redirect).toEqual({
      path: '/linked-enroll',
      hostname: 'localhost',
    })
    // The build list says the same thing.
    const built = (await listPagePaths(ctx)).find(({ path }) => path === '/linked-enrollment')
    expect(built?.page.redirect).toEqual({ path: '/linked-enroll', hostname: 'localhost' })
  })

  it('is not a page at all when its target is not live — and is out of the menus', async () => {
    const parent = await mk({
      tenant: fixtures.tenantA,
      title: 'Linked parent',
      slug: 'linked-parent',
    })
    await mk({
      tenant: fixtures.tenantA,
      title: 'Dead end',
      slug: 'linked-dead-end',
      parent,
      linkMode: 'redirect',
      linkTo: 'district',
      districtLinkTarget: draftDistrictPage,
    })
    const ctx = await ctxFor('a.localhost')
    expect(await getPageByPath(ctx, '/linked-parent/linked-dead-end')).toBeNull()
    expect((await getPageByPath(ctx, '/linked-parent'))?.children).toEqual([])
    const paths = (await listPagePaths(ctx)).map(({ path }) => path)
    expect(paths).toContain('/linked-parent')
    expect(paths).not.toContain('/linked-parent/linked-dead-end')
  })

  it('is null on an ordinary page', async () => {
    expect(
      (await getPageByPath(await ctxFor('a.localhost'), '/published-page-a'))?.redirect,
    ).toBeNull()
  })

  describe('refused on save', () => {
    const attempt = async (data: Record<string, unknown>) => {
      const result = await payload
        .create({
          collection: 'pages',
          data: {
            tenant: fixtures.tenantA,
            title: 'Refused',
            slug: `linked-refused-${Math.floor(Math.random() * 1e9)}`,
            visibility: 'public',
            linkMode: 'redirect',
            _status: 'draft',
            ...data,
          } as never,
          user: fixtures.districtAdmin,
          overrideAccess: false,
        })
        .then(
          (doc) => {
            made.push(doc.id)
            return null
          },
          (err: { data?: unknown }) => JSON.stringify(err.data ?? err),
        )
      return result
    }

    it("refuses another school's page", async () => {
      expect(await attempt({ linkTo: 'site', linkTarget: fixtures.publishedPageB })).toMatch(
        /this site/,
      )
    })

    it('refuses a school page offered as a district page', async () => {
      expect(
        await attempt({ linkTo: 'district', districtLinkTarget: fixtures.publishedPageB }),
      ).toMatch(/district page/)
    })

    it('refuses no target', async () => {
      expect(await attempt({ linkTo: 'site' })).toMatch(/Choose the page/)
    })

    it('refuses the page itself', async () => {
      const id = await mk({ tenant: fixtures.tenantA, title: 'Self', slug: 'linked-self' })
      const refusal = await payload
        .update({
          collection: 'pages',
          id,
          data: { linkMode: 'redirect', linkTo: 'site', linkTarget: id },
          user: fixtures.districtAdmin,
          overrideAccess: false,
        })
        .then(
          () => null,
          (err: { data?: unknown }) => JSON.stringify(err.data ?? err),
        )
      expect(refusal).toMatch(/itself/)
    })

    it('refuses a page that is itself linked', async () => {
      const hop = await mk({
        tenant: fixtures.tenantA,
        title: 'Hop',
        slug: 'linked-hop',
        linkMode: 'redirect',
        linkTo: 'site',
        linkTarget: fixtures.publishedPageA,
      })
      expect(await attempt({ linkTo: 'site', linkTarget: hop })).toMatch(/already/)
    })
  })
})

/**
 * Linked pages, reuse content (Jason, 2026-10-29): a school page shows a DISTRICT page's title
 * and content at the school's own address. Links in that content were written for the district
 * site, so they lead there; the school's menus show the district title; and a source that is
 * not live leaves nothing to show.
 */
describe('linked pages — reuse content', () => {
  const ctxFor = async (hostname: string): Promise<ContentContext> => ({
    tenant: (await getTenantByHostname(hostname))!,
    locale: 'en',
  })
  const made: (string | number)[] = []
  const mk = async (data: Record<string, unknown>) => {
    const doc = await payload.create({
      collection: 'pages',
      data: { visibility: 'public', _status: 'published', ...data } as never,
      user: fixtures.districtAdmin,
      overrideAccess: true,
    })
    made.push(doc.id)
    return doc.id
  }
  const wordsLinking = (link: Record<string, unknown>) => ({
    root: {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              version: 3,
              fields: link,
              children: [{ type: 'text', text: 'Go', format: 0 }],
            },
          ],
        },
      ],
    },
  })
  let enroll: string | number
  let source: string | number
  let draftSource: string | number

  beforeAll(async () => {
    enroll = await mk({
      tenant: fixtures.districtTenant,
      title: 'Enroll now',
      slug: 'reuse-enroll',
    })
    source = await mk({
      tenant: fixtures.districtTenant,
      title: 'District supply list',
      slug: 'reuse-supplies',
      layout: [
        {
          blockType: 'richText',
          content: wordsLinking({
            linkType: 'internal',
            doc: { relationTo: 'pages', value: enroll },
          }),
        },
      ],
      meta: { title: 'Supplies for every school', description: null },
    })
    draftSource = await mk({
      tenant: fixtures.districtTenant,
      title: 'Not ready',
      slug: 'reuse-not-ready',
      _status: 'draft',
    })
  })
  afterAll(async () => {
    for (const id of made.reverse()) {
      await payload.delete({ collection: 'pages', id, overrideAccess: true }).catch(() => null)
    }
  })

  it("shows the district page's title and content at the school's address", async () => {
    await mk({
      tenant: fixtures.tenantA,
      title: 'Our supplies',
      slug: 'reuse-our-supplies',
      linkMode: 'reuse',
      districtLinkTarget: source,
    })
    const ctx = await ctxFor('a.localhost')
    const page = await getPageByPath(ctx, '/reuse-our-supplies')
    expect(page?.title).toBe('District supply list')
    expect(page?.path).toBe('/reuse-our-supplies')
    expect(page?.redirect).toBeNull()
    expect(page?.reusedFrom).toEqual({ path: '/reuse-supplies', hostname: 'localhost' })
    expect(page?.seo.title).toBe('Supplies for every school')
    // The district page's link leads to the district site, not to the school's /reuse-enroll.
    expect(JSON.stringify(page?.layout)).toContain('"href":"http://localhost/reuse-enroll"')

    // The build list says the same.
    const built = (await listPagePaths(ctx)).find(({ path }) => path === '/reuse-our-supplies')
    expect(built?.page.title).toBe('District supply list')
    expect(JSON.stringify(built?.page.layout)).toContain('"href":"http://localhost/reuse-enroll"')
  })

  it("names it by the district page's title in the school's menus", async () => {
    const parent = await mk({
      tenant: fixtures.tenantA,
      title: 'Reuse parent',
      slug: 'reuse-parent',
    })
    await mk({
      tenant: fixtures.tenantA,
      title: 'School label',
      slug: 'reuse-child',
      parent,
      linkMode: 'reuse',
      districtLinkTarget: source,
    })
    const ctx = await ctxFor('a.localhost')
    expect((await getPageByPath(ctx, '/reuse-parent'))?.children.map((c) => c.title)).toEqual([
      'District supply list',
    ])
    const built = (await listPagePaths(ctx)).find(({ path }) => path === '/reuse-parent')
    expect(built?.page.children.map((c) => c.title)).toEqual(['District supply list'])
  })

  it('is not a page at all when the district page is not live', async () => {
    await mk({
      tenant: fixtures.tenantA,
      title: 'Waiting',
      slug: 'reuse-waiting',
      linkMode: 'reuse',
      districtLinkTarget: draftSource,
    })
    const ctx = await ctxFor('a.localhost')
    expect(await getPageByPath(ctx, '/reuse-waiting')).toBeNull()
    expect((await listPagePaths(ctx)).map(({ path }) => path)).not.toContain('/reuse-waiting')
  })

  it("refuses a school's page as the source", async () => {
    const refusal = await payload
      .create({
        collection: 'pages',
        data: {
          tenant: fixtures.tenantA,
          title: 'Refused reuse',
          slug: 'reuse-refused',
          visibility: 'public',
          linkMode: 'reuse',
          districtLinkTarget: fixtures.publishedPageA,
          _status: 'draft',
        } as never,
        user: fixtures.districtAdmin,
        overrideAccess: false,
      })
      .then(
        (doc) => {
          made.push(doc.id)
          return null
        },
        (err: { data?: unknown }) => JSON.stringify(err.data ?? err),
      )
    expect(refusal).toMatch(/district page/)
  })
})
