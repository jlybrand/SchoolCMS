import { toSafeHref } from '@/lib/href'

import { NO_PAGE_PATHS, pathOfPage, type PagePaths } from './page-tree'
import type { MenuLink, Navigation } from './types'

/**
 * Payload `navigation` row -> DD2 menus (`03` §5, `02` §11).
 *
 * PURE, and in its own file for that reason: `navigation.ts` imports the Payload config to
 * run the query, and a unit test that imported the mapper from there would boot the CMS to
 * test a function of its input. Same split as `blocks.ts` and `rich-text.ts`.
 *
 * Takes `unknown` and never throws. A menu renders on every page of a tenant, so the failure
 * this file is shaped around is one bad item taking the header down with it — a malformed
 * item is dropped, and its neighbours render.
 */

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

type MenuName = keyof Navigation

/** For comparison only. `toNavigation` builds fresh arrays and never returns this object. */
export const EMPTY_NAVIGATION: Readonly<Navigation> = Object.freeze({
  primary: [],
  utility: [],
  footer: [],
})

/**
 * Where a link goes. A link to a PAGE (Jason, 2026-10-29) takes the path the page has today,
 * so a rename or a move never breaks the menu; any address stored on the row is ignored. A page
 * with no current path — unpublished, staff-only, deleted, or on another site — gives null and
 * the link is dropped: a menu entry that 404s is a bug (`03` §5).
 *
 * A row with no `linkType` predates link types and is an address.
 */
const hrefOf = (row: Row, paths: PagePaths): string | null => {
  if (row.linkType === 'page') return pathOfPage(row.page, paths)
  return toSafeHref(row.href)
}

const toMenu = (value: unknown, menu: MenuName, paths: PagePaths): MenuLink[] => {
  if (!Array.isArray(value)) return []

  const links: MenuLink[] = []

  value.forEach((row, index) => {
    if (!isRow(row)) return

    const label = str(row.label)
    /**
     * Checked HERE as well as by the field validator. Validation tells the editor; this is
     * what keeps an unsafe destination off the site when the row arrived by a route that
     * never ran it (`src/lib/href.ts`).
     */
    const href = hrefOf(row, paths)

    // No words is a link with no accessible name (WCAG 2.4.4, 4.1.2); no href is not a link.
    if (label === null || href === null) return

    links.push({
      // Positional and menu-prefixed, so a fallback cannot collide across the three lists.
      id: str(row.id) ?? `${menu}-${index}`,
      label,
      href,
      newTab: row.newTab === true,
    })
  })

  return links
}

export const toNavigation = (doc: unknown, paths: PagePaths = NO_PAGE_PATHS): Navigation => {
  const row: Row = isRow(doc) ? doc : {}

  return {
    primary: toMenu(row.primary, 'primary', paths),
    utility: toMenu(row.utility, 'utility', paths),
    footer: toMenu(row.footer, 'footer', paths),
  }
}

/** True when any link in the row points at a page — the only case that needs the page tree. */
export const linksToPages = (doc: unknown): boolean => {
  if (!isRow(doc)) return false
  return (['primary', 'utility', 'footer'] as const).some(
    (menu) =>
      Array.isArray(doc[menu]) &&
      (doc[menu] as unknown[]).some((row) => isRow(row) && row.linkType === 'page'),
  )
}
