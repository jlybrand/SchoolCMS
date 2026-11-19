import { getPayload } from 'payload'

import config from '@payload-config'

import { siteOrigin } from '@/lib/seo'
import { ROOT_SLUG, buildPagePath, splitPagePath } from '@/lib/slug'
import { toPageBlocks } from './blocks'
import { pathIndex, segmentsFor, type PagePaths, type TreeRow } from './page-tree'
import { rehomeBlocks } from './rehome-links'
import { listActiveTenants } from './tenants'
import type { ContentContext, Page, PageBlock, PageLink, PageRedirect, Visibility } from './types'

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
  visibility: Visibility
  parent?: string | number | { id: string | number } | null
  requiresTranslationReview?: boolean | null
  hideFromNavigation?: boolean | null
  hideFromSearchEngines?: boolean | null
  hideFromSiteSearch?: boolean | null
  linkMode?: 'none' | 'redirect' | 'reuse' | null
  linkTo?: 'site' | 'district' | null
  linkTarget?: string | number | { id: string | number } | null
  districtLinkTarget?: string | number | { id: string | number } | null
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
  link: PageLinkResolution | null,
): Page => {
  /**
   * REUSE CONTENT (Jason, 2026-10-29): the district page's title, words, sections and search
   * text, at THIS page's address and in this page's place in the tree. Its links are resolved
   * against the district's paths and then given the district origin, because on the school's
   * host a path would lead to the school's page of that name (`rehome-links.ts`).
   */
  const reuse = link?.kind === 'reuse' ? link : null
  const content = reuse ? reuse.source : doc
  const contentPaths = reuse ? reuse.paths : paths
  const origin = reuse ? siteOrigin(reuse.from.hostname) : null
  const layout = toPageBlocks(content.layout, contentPaths)

  return {
    id: String(doc.id),
    tenantId: String(idOf(doc.tenant as PayloadPage['parent'])),
    title: content.title,
    slug: doc.slug,
    path,
    visibility: doc.visibility,
    parentId: idOf(doc.parent ?? null),
    requiresTranslationReview: doc.requiresTranslationReview === true,
    seo: {
      title: textOrNull(content.meta?.title),
      description: textOrNull(content.meta?.description),
    },
    hideFromSearchEngines: doc.hideFromSearchEngines === true,
    hideFromSiteSearch: doc.hideFromSiteSearch === true,
    redirect: link?.kind === 'redirect' ? link.target : null,
    reusedFrom: reuse ? reuse.from : null,
    // The single point where stored blocks become DD2 ones: nothing downstream sees a
    // `blockType` discriminator or Lexical state (`03` §3).
    layout: origin ? rehomeBlocks(layout, origin) : layout,
    /**
     * The page's own position in the tree, resolved HERE rather than by the block that renders
     * it — `src/blocks/` may not import the SDK (`03` §3.3, decided 2026-08-28).
     */
    children,
  }
}

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

const isLinked = (doc: PayloadPage): boolean =>
  doc.linkMode === 'redirect' || doc.linkMode === 'reuse'

/**
 * What a linked page resolves to (Jason, 2026-10-29): where a REDIRECT sends visitors, or the
 * district page whose title and content a REUSE page shows — with that district's paths, so the
 * content's own links can be resolved and then rehomed (`rehome-links.ts`).
 */
type PageLinkResolution =
  | { kind: 'redirect'; target: PageRedirect }
  | { kind: 'reuse'; from: PageRedirect; source: PayloadPage; paths: PagePaths }

/**
 * Each linked page among `docs`, resolved — or null when its target is not live. A linked page
 * with nowhere to go and nothing to show is not a page, so callers drop it.
 *
 * ISOLATED BY CONSTRUCTION. A "this site" target is looked up in this site's paths and a
 * "district" target, and every reuse source, in the district's — so an id from any other site
 * has no path in either and resolves to null. A reuse source is read from the district's
 * published, public pages, and one that is itself linked shows nothing (no chains). At most one
 * extra query pair for the district's paths, and one for the reuse sources.
 */
const resolveLinks = async (
  ctx: ContentContext,
  docs: readonly PayloadPage[],
  ownPaths: PagePaths,
): Promise<Map<string, PageLinkResolution | null>> => {
  const linked = docs.filter(isLinked)
  const result = new Map<string, PageLinkResolution | null>()
  if (linked.length === 0) return result

  const toDistrict = (doc: PayloadPage) => doc.linkMode === 'reuse' || doc.linkTo === 'district'
  const targetOf = (doc: PayloadPage) =>
    idOf(toDistrict(doc) ? (doc.districtLinkTarget ?? null) : (doc.linkTarget ?? null))

  let district: { tenant: ContentContext['tenant']; paths: PagePaths } | null = null
  if (linked.some(toDistrict)) {
    const tenant =
      ctx.tenant.type === 'district'
        ? ctx.tenant
        : ((await listActiveTenants()).find((t) => t.type === 'district') ?? null)
    if (tenant) {
      district = {
        tenant,
        paths:
          tenant.id === ctx.tenant.id
            ? ownPaths
            : await listPagePathIndex({ tenant, locale: ctx.locale }),
      }
    }
  }

  // The reuse sources, in one query: the district's own published, public pages only.
  const sourceIds = linked
    .filter((doc) => doc.linkMode === 'reuse')
    .map(targetOf)
    .filter((id): id is string => id !== null)
  const sources = new Map<string, PayloadPage>()
  if (district && sourceIds.length > 0) {
    const payload = await getPayload({ config })
    const { docs: rows } = await payload.find({
      collection: 'pages',
      where: {
        and: [
          { id: { in: [...new Set(sourceIds)] } },
          { tenant: { equals: district.tenant.id } },
          ...publishedAndPublic,
        ],
      },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })
    for (const row of rows as PayloadPage[]) sources.set(String(row.id), row)
  }

  for (const doc of linked) {
    const targetId = targetOf(doc)
    const paths = toDistrict(doc) ? district?.paths : ownPaths
    const path = targetId === null ? null : (paths?.get(targetId) ?? null)
    const hostname = toDistrict(doc) ? district?.tenant.hostname : ctx.tenant.hostname
    if (path === null || hostname === undefined) {
      result.set(String(doc.id), null)
      continue
    }
    if (doc.linkMode === 'redirect') {
      result.set(String(doc.id), { kind: 'redirect', target: { path, hostname } })
      continue
    }
    const source = targetId === null ? undefined : sources.get(targetId)
    result.set(
      String(doc.id),
      source && !isLinked(source) && district
        ? { kind: 'reuse', from: { path, hostname }, source, paths: district.paths }
        : null,
    )
  }
  return result
}

/**
 * What a LINKED page shows in Live Preview (Jason, 2026-11-19): what a visitor gets. A reuse page
 * shows the district page's title and sections (`from` names it); a redirect shows none and names
 * where visitors go; a link to nothing live yet shows none either — visitors get "not found".
 */
export type PreviewLink =
  | { kind: 'reuse'; from: PageRedirect; title: string; layout: PageBlock[] }
  | { kind: 'redirect'; to: PageRedirect }
  | { kind: 'unresolved' }

/**
 * `doc` — any version of a page, a draft too — resolved as the public route resolves it
 * (`resolveLinks`: the same targets, the district's published public pages as reuse sources), or
 * null when it is not linked.
 */
export const resolvePreviewLink = async (
  ctx: ContentContext,
  doc: unknown,
): Promise<PreviewLink | null> => {
  const page = doc as PayloadPage
  if (!isLinked(page)) return null
  const links = await resolveLinks(ctx, [page], await listPagePathIndex(ctx))
  const link = links.get(String(page.id)) ?? null
  if (!link) return { kind: 'unresolved' }
  if (link.kind === 'redirect') return { kind: 'redirect', to: link.target }
  return {
    kind: 'reuse',
    from: link.from,
    title: link.source.title,
    layout: rehomeBlocks(
      toPageBlocks(link.source.layout, link.paths),
      siteOrigin(link.from.hostname),
    ),
  }
}

/** A linked page with nowhere to go and nothing to show is not a page (see `resolveLinks`). */
const isLive = (doc: PayloadPage, links: ReadonlyMap<string, PageLinkResolution | null>): boolean =>
  !isLinked(doc) || links.get(String(doc.id)) != null

/** How a page is named in a menu: a reuse page by the district page it shows (Jason). */
const menuTitle = (
  doc: PayloadPage,
  links: ReadonlyMap<string, PageLinkResolution | null>,
): string => {
  const link = links.get(String(doc.id))
  return link?.kind === 'reuse' ? link.source.title : doc.title
}

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

  const childDocs = isFrontPage ? [] : await childrenOf(payload, ctx, current)
  const paths = await listPagePathIndex(ctx)
  const links = await resolveLinks(ctx, [current, ...childDocs], paths)

  // A linked page whose target is not live 404s, like a missing one.
  if (!isLive(current, links)) return null

  const children = byTitle(
    childDocs
      .filter((doc) => inNavigation(doc) && isLive(doc, links))
      .map((doc) => ({
        id: String(doc.id),
        title: menuTitle(doc, links),
        // Assembled from the parent's own segments, so a child's path is the parent's plus one.
        path: buildPagePath([...lookup, doc.slug]),
      })),
  )

  return toDomain(
    current,
    buildPagePath(lookup),
    children,
    paths,
    links.get(String(current.id)) ?? null,
  )
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
): Promise<PayloadPage[]> => {
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

  // Filtered by the caller, which also knows which linked children have somewhere to go.
  return docs as PayloadPage[]
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

  const reachableAll: { doc: PayloadPage; path: string }[] = []
  for (const doc of pages) {
    // The shared walk (`page-tree.ts`) — the same answer a permalink and a menu link get.
    const segments = segmentsFor(doc, byId)
    if (!segments) continue
    reachableAll.push({ doc, path: buildPagePath(segments) })
  }

  /**
   * Linked pages resolved from the same set, and the ones with nowhere to go left out — the
   * resolver 404s them, and a static param for a 404 is the disagreement this list exists to
   * avoid. Their own children keep their paths: the parent row is still there to walk.
   */
  const allPaths: PagePaths = new Map(reachableAll.map(({ doc, path }) => [String(doc.id), path]))
  const links = await resolveLinks(
    ctx,
    reachableAll.map(({ doc }) => doc),
    allPaths,
  )
  const reachable = reachableAll.filter(({ doc }) => isLive(doc, links))

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
    siblings.push({ id: String(doc.id), title: menuTitle(doc, links), path })
    childrenByParent.set(parent, siblings)
  }

  // Every page's links resolved from the same set — no query per page.
  return reachable.map(({ doc, path }) => ({
    path,
    page: toDomain(
      doc,
      path,
      byTitle(childrenByParent.get(String(doc.id)) ?? []),
      allPaths,
      links.get(String(doc.id)) ?? null,
    ),
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
