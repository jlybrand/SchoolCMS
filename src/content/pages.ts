import { getPayload } from 'payload'

import config from '@payload-config'

import { ROOT_SLUG, buildPagePath, splitPagePath } from '@/lib/slug'
import { toPageBlocks } from './blocks'
import { pathIndex, segmentsFor, type PagePaths, type TreeRow } from './page-tree'
import { toRichText } from './rich-text'
import type { ContentContext, Page, PageLink, PageType, Visibility } from './types'

/**
 * Page lookups (`02` §11, ADR-5).
 *
 * ============================================================================
 * THIS FILE IS ON THE PAYLOAD SIDE OF THE BOUNDARY.
 * It may import the SDK. It returns DD2 domain types and nothing else.
 * ============================================================================
 *
 * Every function here runs at BUILD or REVALIDATE time, never per visitor — the database is
 * not in the public request path (`02` §5). That is what lets an admin or database outage
 * pause publishing without interrupting serving, and it is also what makes the
 * segment-walking lookup below affordable.
 */

/**
 * Payload's shape for a page row. Declared locally rather than imported from
 * `payload-types`, for the same reason `tenants.ts` does it: a schema regeneration must
 * fail the mapper's compile rather than silently change the domain type the rendering layer
 * consumes.
 */
type PayloadPage = {
  id: string | number
  tenant: string | number | { id: string | number }
  title: string
  slug: string
  pageType: PageType
  visibility: Visibility
  parent?: string | number | { id: string | number } | null
  requiresTranslationReview?: boolean | null
  hideFromNavigation?: boolean | null
  hideFromSearchEngines?: boolean | null
  /** Lexical editor state. Deliberately `unknown` — see `toRichText`. */
  body?: unknown
  /** Block rows. Deliberately `unknown` — see `toPageBlocks`. */
  layout?: unknown
  /** The SEO group. `meta` here — see src/collections/Pages.ts — and `seo` in the domain. */
  meta?: { title?: string | null; description?: string | null } | null
  _status?: 'draft' | 'published' | null
}

const idOf = (ref: PayloadPage['parent']): string | null => {
  if (ref === null || ref === undefined) return null
  if (typeof ref === 'object') return String(ref.id)
  return String(ref)
}

/** Whitespace-only is nothing: an editor who cleared the field with a space meant "none". */
const textOrNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/**
 * Child pages in the order a menu renders them: by title, always.
 *
 * SORTED IN MEMORY rather than by the database, so `getPageByPath` (which queries) and
 * `listPagePaths` (which groups a result set it already has) cannot order the same page's
 * children differently. An explicit locale keeps the build and the test environment agreeing.
 *
 * Alphabetical is the only deterministic order available: `pages` has no manual ordering
 * field, and adding one is a decision about the authoring model, not something to invent here.
 */
const byTitle = (links: PageLink[]): PageLink[] =>
  [...links].sort((a, b) => a.title.localeCompare(b.title, 'en'))

/**
 * Enough children for any real section menu. A page with more than this beneath it is a
 * structure problem, and rendering two hundred links would be one too.
 */
const MAX_CHILDREN = 200

/**
 * `paths` is this site's page id -> current path, so links to a page in the body and the blocks
 * take the address the page has today (Jason, 2026-10-29).
 */
const toDomain = (
  doc: PayloadPage,
  path: string,
  children: PageLink[],
  paths: PagePaths,
): Page => ({
  id: String(doc.id),
  tenantId: String(idOf(doc.tenant as PayloadPage['parent'])),
  title: doc.title,
  slug: doc.slug,
  path,
  pageType: doc.pageType,
  visibility: doc.visibility,
  parentId: idOf(doc.parent ?? null),
  requiresTranslationReview: doc.requiresTranslationReview === true,
  // The single point where Lexical becomes DD2 nodes. Nothing downstream sees editor state.
  body: toRichText(doc.body, paths),
  seo: { title: textOrNull(doc.meta?.title), description: textOrNull(doc.meta?.description) },
  hideFromSearchEngines: doc.hideFromSearchEngines === true,
  // Likewise for blocks: nothing downstream sees a `blockType` discriminator (`03` §3).
  layout: toPageBlocks(doc.layout, paths),
  /**
   * The page's own position in the tree, resolved HERE rather than by the block that renders
   * it — `src/blocks/` may not import the SDK (`03` §3.3, decided 2026-08-28).
   */
  children,
})

/**
 * The published, publicly-visible constraint.
 *
 * Applied on top of `overrideAccess: true`, which is deliberate and worth being explicit
 * about: access is overridden because this is the platform rendering its own site rather
 * than a user reading data, so the filtering that keeps drafts and staff-only pages off the
 * public site has to be stated HERE. Access functions are not doing it on this path.
 */
const publishedAndPublic = [
  { _status: { equals: 'published' } },
  { visibility: { equals: 'public' } },
]

/**
 * Resolves a URL path to a page within one tenant.
 *
 * WALKS THE SEGMENTS rather than reading a stored path. `/about/staff` becomes: find
 * `about` with no parent, then find `staff` whose parent is that page — one indexed query
 * per segment, and page paths are one to three segments deep in practice.
 *
 * The alternative, denormalizing a `path` column, buys a single-query lookup and costs a
 * cascade: renaming one page's slug has to rewrite every descendant's stored path, and any
 * write that misses the cascade leaves rows whose stored path disagrees with their actual
 * position. That is a silent-wrong-page bug, and it would be cached (`02` §5). Since these
 * queries do not run per visitor, the cheaper failure mode is worth more than the cheaper
 * query.
 *
 * THE TENANT ROOT. `/` has no segment to walk, so it resolves to the top-level page slugged
 * `ROOT_SLUG` — the reserved-slug convention rather than a slug-less row, which keeps `slug`
 * required and therefore keeps `listPagePaths`' parent-chain assembly total. `/home` is
 * REFUSED, so the front page has exactly one URL instead of two competing for one CDN cache
 * entry (`02` §5). Refusing rather than redirecting keeps this a pure lookup; a redirect is a
 * routing concern if DD2 ever wants one.
 *
 * Returns null when any segment is missing, when the page is a draft, or when it is
 * staff-only. Never falls back to a parent or a sibling — a near-miss served as a hit is
 * how one page's content ends up under another page's URL.
 */
export const getPageByPath = async (
  ctx: ContentContext,
  path: string | null | undefined,
): Promise<Page | null> => {
  /**
   * `null`/`undefined` mean nothing was asked for; `/` and `''` are requests for the front
   * page. Kept distinct so a caller's missing argument cannot look like a successful lookup.
   */
  if (path === null || path === undefined) return null

  const segments = splitPagePath(path)

  // The front page is reachable at `/` only.
  if (segments[0] === ROOT_SLUG) return null

  const lookup = segments.length === 0 ? [ROOT_SLUG] : segments

  const payload = await getPayload({ config })

  let parentId: string | null = null
  let current: PayloadPage | null = null

  for (const slug of lookup) {
    const { docs } = await payload.find({
      collection: 'pages',
      where: {
        and: [
          { tenant: { equals: ctx.tenant.id } },
          { slug: { equals: slug } },
          parentId === null ? { parent: { exists: false } } : { parent: { equals: parentId } },
          ...publishedAndPublic,
        ],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    const doc = docs[0] as PayloadPage | undefined
    if (!doc) return null

    current = doc
    parentId = String(doc.id)
  }

  if (!current) return null

  /**
   * THE FRONT PAGE HAS NO CHILDREN, even if rows point at it. Their paths would start
   * `/home/`, which this function refuses so the front page has exactly one URL — so they have
   * no reachable URL and must not appear in a menu. `rootPageCannotBeParent` refuses the shape
   * on write; this is the resolution half of the same guarantee, and only one of the two
   * survives a migration or a direct database write.
   */
  const isFrontPage = lookup.length === 1 && lookup[0] === ROOT_SLUG

  const children = isFrontPage ? [] : await childrenOf(payload, ctx, current, lookup)

  return toDomain(current, buildPagePath(lookup), children, await listPagePathIndex(ctx))
}

/**
 * Whether a page belongs in the section menus built from the tree (Jason, 2026-10-29). Read in
 * memory rather than queried, so a row saved before the field existed — null, not false — is
 * in the menu without a null-aware query.
 */
const inNavigation = (doc: PayloadPage): boolean => doc.hideFromNavigation !== true

/**
 * The published, public pages directly beneath one page, as links.
 *
 * The same `publishedAndPublic` filter the page itself passed. A draft child in a menu would
 * publish its title and its URL — enough to leak that unannounced content exists, and enough
 * for the link to 404 (`03` §6.4).
 *
 * One query, at build or revalidate time, for a page that actually renders a section menu.
 */
const childrenOf = async (
  payload: Awaited<ReturnType<typeof getPayload>>,
  ctx: ContentContext,
  parent: PayloadPage,
  parentSegments: string[],
): Promise<PageLink[]> => {
  const { docs } = await payload.find({
    collection: 'pages',
    where: {
      and: [
        { tenant: { equals: ctx.tenant.id } },
        { parent: { equals: parent.id } },
        ...publishedAndPublic,
      ],
    },
    limit: MAX_CHILDREN,
    depth: 0,
    overrideAccess: true,
  })

  return byTitle(
    (docs as PayloadPage[]).filter(inNavigation).map((doc) => ({
      id: String(doc.id),
      title: doc.title,
      // Assembled from the parent's own segments, so a child's path is the parent's plus one.
      path: buildPagePath([...parentSegments, doc.slug]),
    })),
  )
}

/**
 * Every published, public page in a tenant, as `{ path, page }`.
 *
 * Used to generate static params so all 28 sites build. Paths are assembled in memory from
 * the parent chain, which is one query for the whole tenant rather than one per page.
 *
 * A page whose parent is missing or unpublished is SKIPPED, not hoisted to the root. Its
 * URL genuinely does not exist while the parent is unpublished, and inventing a shorter one
 * would publish a page the editor did not intend to expose. A page nested under the front page
 * is skipped for the same reason — see `segmentsFor`.
 */
export const listPagePaths = async (
  ctx: ContentContext,
): Promise<{ path: string; page: Page }[]> => {
  const payload = await getPayload({ config })

  const { docs } = await payload.find({
    collection: 'pages',
    where: { and: [{ tenant: { equals: ctx.tenant.id } }, ...publishedAndPublic] },
    limit: 5000,
    depth: 0,
    sort: 'slug',
    overrideAccess: true,
  })

  const pages = docs as PayloadPage[]
  const byId = new Map<string, TreeRow>(pages.map((doc) => [String(doc.id), doc]))

  const reachable: { doc: PayloadPage; path: string }[] = []
  for (const doc of pages) {
    // The shared walk (`page-tree.ts`) — the same answer a permalink and a menu link get.
    const segments = segmentsFor(doc, byId)
    if (!segments) continue
    reachable.push({ doc, path: buildPagePath(segments) })
  }

  /**
   * Children assembled from the result set already in hand — NO extra query, and none per
   * page. This function maps every published page in the tenant, so a per-page child lookup
   * would be an N+1 across 28 tenant builds for data that costs nothing to group here.
   *
   * Built from `reachable` rather than from `pages`, which is what keeps it honest: a page
   * with no reachable URL is not a menu entry, so skipping it once covers both.
   */
  const childrenByParent = new Map<string, PageLink[]>()
  for (const { doc, path } of reachable) {
    const parent = idOf(doc.parent ?? null)
    if (parent === null || !inNavigation(doc)) continue

    const siblings = childrenByParent.get(parent) ?? []
    siblings.push({ id: String(doc.id), title: doc.title, path })
    childrenByParent.set(parent, siblings)
  }

  // Every page's links resolved from the same set — no query per page.
  const paths: PagePaths = new Map(reachable.map(({ doc, path }) => [String(doc.id), path]))

  return reachable.map(({ doc, path }) => ({
    path,
    page: toDomain(doc, path, byTitle(childrenByParent.get(String(doc.id)) ?? []), paths),
  }))
}

/**
 * Every published, public page in a tenant, by id, at the path it has today.
 *
 * What resolves a permalink and a menu link to a page (Jason, 2026-10-29), so neither stores
 * an address that a rename or a move would strand. One query for the whole tenant, reading
 * only what the tree needs, at build or revalidate time.
 */
export const listPagePathIndex = async (ctx: ContentContext): Promise<Map<string, string>> => {
  const payload = await getPayload({ config })

  const { docs } = await payload.find({
    collection: 'pages',
    where: { and: [{ tenant: { equals: ctx.tenant.id } }, ...publishedAndPublic] },
    limit: 5000,
    depth: 0,
    select: { slug: true, parent: true },
    overrideAccess: true,
  })

  return pathIndex(docs as unknown as TreeRow[])
}

/**
 * Where a permalink goes: the page's path today, or null.
 *
 * Null for a page on ANOTHER site, as well as for a missing, draft or staff-only one — the
 * `tenant` clause in `listPagePathIndex` is the only scoping on this path. `/dd2/pages/<id>` on one
 * school's host must never redirect into another school's page, and must not tell the two
 * cases apart, or it becomes a way to learn which ids exist elsewhere (`03` §6.4).
 */
export const getPagePathById = async (ctx: ContentContext, id: string): Promise<string | null> =>
  (await listPagePathIndex(ctx)).get(id) ?? null
