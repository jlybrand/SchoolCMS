import { beforeAll, describe, expect, it } from 'vitest'

import { getPageByPath, listPagePaths } from '@/content/pages'
import { getTenantByHostname, listActiveTenants } from '@/content/tenants'
import type { ContentContext, Tenant } from '@/content/types'
import { ROOT_SLUG } from '@/lib/slug'
import type { Payload } from 'payload'

import { getTestPayload, seed } from '../helpers/payload'

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
    for (const leaked of ['createdAt', 'updatedAt', '_status', 'powerSchoolBuildingId', 'status']) {
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
          pageType: 'standard',
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
  })
})
