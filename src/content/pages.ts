import { getPayload } from 'payload'

import config from '@payload-config'

import { buildPagePath, splitPagePath } from '@/lib/slug'
import type { ContentContext, Page, PageType, Visibility } from './types'

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
  _status?: 'draft' | 'published' | null
}

const idOf = (ref: PayloadPage['parent']): string | null => {
  if (ref === null || ref === undefined) return null
  if (typeof ref === 'object') return String(ref.id)
  return String(ref)
}

const toDomain = (doc: PayloadPage, path: string): Page => ({
  id: String(doc.id),
  tenantId: String(idOf(doc.tenant as PayloadPage['parent'])),
  title: doc.title,
  slug: doc.slug,
  path,
  pageType: doc.pageType,
  visibility: doc.visibility,
  parentId: idOf(doc.parent ?? null),
  requiresTranslationReview: doc.requiresTranslationReview === true,
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
 * Returns null when any segment is missing, when the page is a draft, or when it is
 * staff-only. Never falls back to a parent or a sibling — a near-miss served as a hit is
 * how one page's content ends up under another page's URL.
 */
export const getPageByPath = async (
  ctx: ContentContext,
  path: string | null | undefined,
): Promise<Page | null> => {
  const segments = splitPagePath(path)
  if (segments.length === 0) return null

  const payload = await getPayload({ config })

  let parentId: string | null = null
  let current: PayloadPage | null = null

  for (const slug of segments) {
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

  return current ? toDomain(current, buildPagePath(segments)) : null
}

/**
 * Every published, public page in a tenant, as `{ path, page }`.
 *
 * Used to generate static params so all 28 sites build. Paths are assembled in memory from
 * the parent chain, which is one query for the whole tenant rather than one per page.
 *
 * A page whose parent is missing or unpublished is SKIPPED, not hoisted to the root. Its
 * URL genuinely does not exist while the parent is unpublished, and inventing a shorter one
 * would publish a page the editor did not intend to expose.
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
  const byId = new Map(pages.map((doc) => [String(doc.id), doc]))

  const segmentsFor = (doc: PayloadPage): string[] | null => {
    const chain: string[] = []
    let cursor: PayloadPage | undefined = doc
    // Bounded by the map size, so a parent cycle introduced by bad data terminates here
    // rather than hanging the build.
    const seen = new Set<string>()

    while (cursor) {
      const id = String(cursor.id)
      if (seen.has(id)) return null
      seen.add(id)

      chain.unshift(cursor.slug)

      const parent = idOf(cursor.parent ?? null)
      if (parent === null) return chain

      cursor = byId.get(parent)
    }

    // Parent exists but is not in the published set — the page has no reachable URL.
    return null
  }

  const results: { path: string; page: Page }[] = []
  for (const doc of pages) {
    const segments = segmentsFor(doc)
    if (!segments) continue
    const path = buildPagePath(segments)
    results.push({ path, page: toDomain(doc, path) })
  }

  return results
}
