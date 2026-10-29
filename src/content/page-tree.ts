import { ROOT_SLUG, buildPagePath } from '@/lib/slug'

/**
 * Page id -> the page's current path, for one tenant (`03` §2).
 *
 * PURE, and in its own file for the reason `menus.ts` is: `pages.ts` boots the CMS, and this is
 * a function of its input. It is the one definition of "the path a page has today" that the
 * build (`listPagePaths`), permalinks and menu links to a page all share, so they cannot
 * disagree about where a page is.
 *
 * Hand it the tenant's PUBLISHED, PUBLIC rows only. A page whose parent is not among them has
 * no reachable URL and is left out — never hoisted to a shorter, invented path that would
 * publish a page its editor did not intend to expose.
 */

export type TreeRow = {
  id: string | number
  slug: string
  parent?: string | number | { id: string | number } | null
}

const parentIdOf = (ref: TreeRow['parent']): string | null => {
  if (ref === null || ref === undefined) return null
  if (typeof ref === 'object') return String(ref.id)
  return String(ref)
}

/** The slugs from the root down to `doc`, or null when it has no reachable URL. */
export const segmentsFor = (doc: TreeRow, byId: ReadonlyMap<string, TreeRow>): string[] | null => {
  const chain: string[] = []
  let cursor: TreeRow | undefined = doc
  // Bounded by the map size, so a parent cycle introduced by bad data terminates here
  // rather than hanging the build.
  const seen = new Set<string>()

  while (cursor) {
    const id = String(cursor.id)
    if (seen.has(id)) return null
    seen.add(id)

    chain.unshift(cursor.slug)

    const parent = parentIdOf(cursor.parent)
    if (parent === null) {
      /**
       * A page NESTED under the front page has no reachable URL: its path would start
       * `/home/...`, and `getPageByPath` refuses anything under `/home` so that the front
       * page has one URL. Emitting it would generate a static param for a route that 404s
       * at request time.
       *
       * `rootPageCannotBeParent` refuses this shape on write, so it should not exist — but
       * validation and resolution are separate guarantees, and a migration or a direct
       * database write only has to defeat the first one.
       */
      if (chain.length > 1 && chain[0] === ROOT_SLUG) return null

      return chain
    }

    cursor = byId.get(parent)
  }

  // Parent exists but is not in the published set — the page has no reachable URL.
  return null
}

/**
 * Page id -> current path, as `pathIndex` returns it. What every mapper that renders a link to
 * a page is handed: menus, block buttons and cards, and links in the words.
 */
export type PagePaths = ReadonlyMap<string, string>

export const NO_PAGE_PATHS: PagePaths = new Map()

/** A page reference as Payload stores it — an id, or the populated page — as a string id. */
export const pageIdOf = (value: unknown): string | null => {
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return String(id)
  }
  return null
}

/** Where a page reference leads today, or null when it has no current path. */
export const pathOfPage = (value: unknown, paths: PagePaths): string | null => {
  const id = pageIdOf(value)
  return id === null ? null : (paths.get(id) ?? null)
}

export const pathIndex = (rows: readonly TreeRow[]): Map<string, string> => {
  const byId = new Map(rows.map((row) => [String(row.id), row]))
  const paths = new Map<string, string>()
  for (const row of rows) {
    const segments = segmentsFor(row, byId)
    if (segments) paths.set(String(row.id), buildPagePath(segments))
  }
  return paths
}
