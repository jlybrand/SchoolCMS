import { relationshipIdOf } from '@/access/predicates'

/**
 * A menu link to a page must name a page on the menu's own site (Jason, 2026-10-29).
 *
 * WHY A VALIDATOR AS WELL AS `filterOptions`. Payload checks a relationship against its
 * `filterOptions` on save, but ours is keyed to `data.tenant` — and a partial update that
 * sends only the menus carries no tenant, so the filter allows everything. The render drops
 * another site's page regardless (`src/content/menus.ts`, through a tenant-scoped path index),
 * which is the guarantee; this is what makes the admin say so instead of saving a link that
 * silently never appears.
 *
 * PURE apart from the two injected lookups, so it is tested without the CMS.
 */

export type MenuPageLinkInput = {
  linkType?: unknown
  page?: unknown
  /** The menu row's site, when the write names it. */
  tenant?: unknown
  /** The menu row being updated, to read its site from when the write does not. */
  menuId?: unknown
}

export type MenuPageLinkDeps = {
  tenantOfPage: (id: string) => Promise<string | null>
  tenantOfMenu: (id: string) => Promise<string | null>
}

const OTHER_SITE = 'Choose a page on this site. A menu can only link to its own site’s pages.'

export const validateMenuPageLink = async (
  input: MenuPageLinkInput,
  deps: MenuPageLinkDeps,
): Promise<true | string> => {
  if (input.linkType !== 'page') return true

  const pageId = relationshipIdOf(input.page as never)
  if (pageId === null) return 'Choose the page this link goes to.'

  const menuId = relationshipIdOf(input.menuId as never)
  const site =
    relationshipIdOf(input.tenant as never) ??
    (menuId === null ? null : await deps.tenantOfMenu(menuId))
  // No site to compare against: refuse rather than guess.
  if (site === null) return OTHER_SITE

  return (await deps.tenantOfPage(pageId)) === site ? true : OTHER_SITE
}
