import { relationshipIdOf } from '@/access/predicates'

/**
 * A link to a page — a menu link, a button, a card — must name a page on its own site (Jason,
 * 2026-10-29). The OWNER is the record the link is saved in: the `navigation` row, or the page
 * whose block holds it.
 *
 * WHY A VALIDATOR AS WELL AS `filterOptions`. Payload checks a relationship against its
 * `filterOptions` on save, but ours is keyed to `data.tenant` — and a partial update that
 * does not resend the tenant carries none, so the filter allows everything. The render drops
 * another site's page regardless (`src/content/page-tree.ts`, through a tenant-scoped path
 * index), which is the guarantee; this is what makes the admin say so instead of saving a link
 * that silently never appears.
 *
 * PURE apart from the two injected lookups, so it is tested without the CMS.
 */

export type PageLinkInput = {
  linkType?: unknown
  page?: unknown
  /** The owner's site, when the write names it. */
  tenant?: unknown
  /** The owner being updated, to read its site from when the write does not. */
  ownerId?: unknown
}

export type PageLinkDeps = {
  tenantOfPage: (id: string) => Promise<string | null>
  tenantOfOwner: (id: string) => Promise<string | null>
}

const OTHER_SITE = 'Choose a page on this site. Links here can only go to this site’s pages.'

export const validatePageLink = async (
  input: PageLinkInput,
  deps: PageLinkDeps,
): Promise<true | string> => {
  if (input.linkType !== 'page') return true

  const pageId = relationshipIdOf(input.page as never)
  if (pageId === null) return 'Choose the page this link goes to.'

  const ownerId = relationshipIdOf(input.ownerId as never)
  const site =
    relationshipIdOf(input.tenant as never) ??
    (ownerId === null ? null : await deps.tenantOfOwner(ownerId))
  // No site to compare against: refuse rather than guess.
  if (site === null) return OTHER_SITE

  return (await deps.tenantOfPage(pageId)) === site ? true : OTHER_SITE
}
