import { toSafeHref } from '@/lib/href'

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

const toMenu = (value: unknown, menu: MenuName): MenuLink[] => {
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
    const href = toSafeHref(row.href)

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

export const toNavigation = (doc: unknown): Navigation => {
  const row: Row = isRow(doc) ? doc : {}

  return {
    primary: toMenu(row.primary, 'primary'),
    utility: toMenu(row.utility, 'utility'),
    footer: toMenu(row.footer, 'footer'),
  }
}
