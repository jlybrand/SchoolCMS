/**
 * Permalinks (Jason, 2026-10-29) — an address for a page that does not change when the page is
 * renamed or moved, as Finalsite's `/fs/pages/<id>` does.
 *
 * `/p/<id>` redirects to wherever the page is now. The id is the page's database id: it is
 * already public in every API response, it never changes, and it needs no second identifier
 * kept unique alongside it.
 *
 * PURE. The route that answers it is `src/app/(frontend)/sites/[hostname]/[locale]/p/[id]`.
 */

/** The top-level segment. Reserved in `src/lib/slug.ts`, so no page can take `/p`. */
export const PERMALINK_SEGMENT = 'p'

export const permalinkPath = (id: string | number): string => `/${PERMALINK_SEGMENT}/${String(id)}`

/**
 * A positive integer with no leading zero, short enough to be a row id. Anything else is
 * refused before it reaches a query — `/p/` is not a way to put arbitrary input in front of the
 * database, and `/p/012` is not a second permalink for page 12.
 */
const PAGE_ID = /^[1-9]\d{0,17}$/

export const parsePermalinkId = (raw: string | null | undefined): string | null =>
  typeof raw === 'string' && PAGE_ID.test(raw) ? raw : null
