import type { Field, RelationshipFieldSingleValidation } from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { validateHref } from '@/lib/href'
import { validatePageLink } from '@/lib/page-link'

/**
 * Where a link goes: a page on this site, or a web address (Jason, 2026-10-29) — shared by
 * menu links, the call-to-action button and cards.
 *
 * A link to a page stores the PAGE, not its path, so renaming or moving it never breaks the
 * link; the content layer resolves it at render (`src/content/page-tree.ts`). A row saved
 * before `linkType` existed has no value and reads as an address there.
 *
 * `optional` (cards) adds "Nothing" and makes it the default; otherwise the default is a page.
 * `owner` is the collection the link is SAVED in — the menu row, or the page holding the block —
 * which is what "this site" means to the validator.
 *
 * A radio, not a select: Payload's select fails axe (`docs/phases/04` §17).
 */

type LinkFieldsOptions = {
  owner: 'pages' | 'navigation'
  optional?: boolean
  hrefDescription: string
}

type LinkType = 'none' | 'page' | 'address'

const linkTypeOf = (siblingData: unknown): unknown =>
  (siblingData as { linkType?: unknown } | undefined)?.linkType

export const linkFields = ({
  owner,
  optional = false,
  hrefDescription,
}: LinkFieldsOptions): Field[] => {
  const options: { label: string; value: LinkType }[] = [
    ...(optional ? [{ label: 'Nothing', value: 'none' as const }] : []),
    { label: 'A page on this site', value: 'page' },
    { label: 'A web address', value: 'address' },
  ]

  return [
    {
      name: 'linkType',
      type: 'radio',
      defaultValue: optional ? 'none' : 'page',
      label: 'Links to',
      options,
    },
    {
      name: 'page',
      type: 'relationship',
      relationTo: 'pages',
      label: 'Page',
      admin: {
        condition: (_data, siblingData) => linkTypeOf(siblingData) === 'page',
        description: 'Keeps working if the page is renamed or moved.',
      },
      /** This site's pages only — the same convenience, and the same reason, as `pages.parent`. */
      filterOptions: ({ data }) => {
        const tenant = (data as { tenant?: unknown } | undefined)?.tenant
        return tenant === undefined || tenant === null ? true : { tenant: { equals: tenant } }
      },
      /** Required on a page link, and on this site — see `src/lib/page-link.ts`. */
      validate: (async (value, { data, id, req, siblingData }) => {
        const tenantOf = async (collection: 'pages' | 'navigation', docId: string) => {
          const doc = await req.payload
            .findByID({ collection, id: docId, depth: 0, overrideAccess: true, req })
            .catch(() => null)
          return relationshipIdOf((doc as { tenant?: unknown } | null)?.tenant as never)
        }
        return validatePageLink(
          {
            linkType: linkTypeOf(siblingData),
            page: value,
            tenant: (data as { tenant?: unknown } | undefined)?.tenant,
            ownerId: id,
          },
          {
            tenantOfPage: (pageId) => tenantOf('pages', pageId),
            tenantOfOwner: (ownerId) => tenantOf(owner, ownerId),
          },
        )
      }) satisfies RelationshipFieldSingleValidation,
    },
    {
      name: 'href',
      type: 'text',
      label: 'Goes to',
      admin: {
        /**
         * Shown for an address — and for a row with no link type, so an old row's address is
         * still there to see and fix.
         */
        condition: (_data, siblingData) => {
          const type = linkTypeOf(siblingData)
          return type !== 'page' && type !== 'none'
        },
        description: hrefDescription,
      },
      // Required for an address only; a page link and "Nothing" carry none.
      validate: (value: unknown, { siblingData }: { siblingData?: unknown }) => {
        const type = linkTypeOf(siblingData)
        return type === 'page' || type === 'none' ? true : validateHref(value, { required: true })
      },
    },
  ]
}
