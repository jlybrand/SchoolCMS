/**
 * Permalinks (Jason, 2026-10-29) — an address for a page that does not change when the page is
 * renamed or moved, as Finalsite's `/fs/pages/<id>` does.
 *
 * `/dd2/pages/<id>` redirects to wherever the page is now. The id is the page's database id: it is
 * already public in every API response, it never changes, and it needs no second identifier
 * kept unique alongside it.
 *
 * PURE. The route that answers it is
 * `src/app/(frontend)/sites/[hostname]/[locale]/dd2/pages/[id]`.
 */

/**
 * The top-level segment — the platform's own namespace on every site, named by Jason
 * (2026-10-29). Reserved in `src/lib/slug.ts`, so no page can take `/dd2`; everything else the
 * platform answers on a public host can live beneath it later without reserving another slug.
 */
export const PERMALINK_SEGMENT = 'dd2'

export const permalinkPath = (id: string | number): string =>
  `/${PERMALINK_SEGMENT}/pages/${String(id)}`

/**
 * A positive integer with no leading zero, short enough to be a row id. Anything else is
 * refused before it reaches a query — `/dd2/pages/` is not a way to put arbitrary input in front of the
 * database, and `/dd2/pages/012` is not a second permalink for page 12.
 */
const PAGE_ID = /^[1-9]\d{0,17}$/

export const parsePermalinkId = (raw: string | null | undefined): string | null =>
  typeof raw === 'string' && PAGE_ID.test(raw) ? raw : null
