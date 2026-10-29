import type {
  ArrayField,
  CollectionConfig,
  Field,
  RelationshipFieldSingleValidation,
} from 'payload'

import { districtOnly } from '@/access/tenant-scoped'
import { relationshipIdOf } from '@/access/predicates'
import { validateHref } from '@/lib/href'
import { validateMenuPageLink } from '@/lib/menu-page-link'

/**
 * `navigation` — a tenant's primary, utility and footer menus (`03` §5).
 *
 * A TENANT-SCOPED COLLECTION WITH ONE ROW PER TENANT, not a Payload global. A Payload global
 * is one document for the whole install, and there are 28 sites; `plugin-multi-tenant`'s
 * `isGlobal` (see src/payload.config.ts) is what makes this collection behave as "the
 * site's menus" in the admin, and it makes the injected `tenant` field UNIQUE — so the
 * database, not a hook, refuses a second row for the same site.
 *
 * DISTRICT-ONLY, ALL FOUR OPERATIONS (`03` §6.1: a school-manager "cannot touch theme,
 * navigation…"). Read included: a school manager has nothing to do with this record, and
 * denying the read is also what keeps it out of their admin entirely (`04` §2.1). The public
 * site does not read through access control — `src/content/navigation.ts` does, with access
 * overridden, at build and revalidate time (`02` §5).
 *
 * NO DRAFTS OR VERSIONS. Drafts exist on `pages` to carry a school's pending change request
 * (`04` §5); nobody who can edit this needs approval, so a draft state here would be a
 * second concept with no workflow behind it.
 *
 * Per CLAUDE.md's TDD exception table the declarations are not test-first. The behaviour is
 * `validateHref` and the mapper in `src/content/menus.ts`, and both are.
 */

const linkFields: Field[] = [
  {
    name: 'label',
    type: 'text',
    required: true,
    label: 'Words',
    admin: {
      description:
        'What the link says. Name the destination — "Lunch menus", never "Click here" (WCAG 2.4.4).',
    },
  },
  {
    /**
     * A page, or an address (Jason, 2026-10-29). A link to a page stores the page, not its
     * path, so renaming or moving it never breaks the menu — `src/content/menus.ts` resolves
     * it at render. A row saved before this field existed has no value and reads as an address.
     *
     * A radio, not a select: Payload's select fails axe (`docs/phases/04` §17).
     */
    name: 'linkType',
    type: 'radio',
    defaultValue: 'page',
    label: 'Links to',
    options: [
      { label: 'A page on this site', value: 'page' },
      { label: 'A web address', value: 'address' },
    ],
  },
  {
    name: 'page',
    type: 'relationship',
    relationTo: 'pages',
    label: 'Page',
    admin: {
      condition: (_data, siblingData) => siblingData?.linkType === 'page',
      description: 'Keeps working if the page is renamed or moved.',
    },
    /** This site's pages only — the same convenience, and the same reason, as `pages.parent`. */
    filterOptions: ({ data }) => {
      const tenant = (data as { tenant?: unknown } | undefined)?.tenant
      return tenant === undefined || tenant === null ? true : { tenant: { equals: tenant } }
    },
    /** Required on a page link, and on this site — see `src/lib/menu-page-link.ts`. */
    validate: (async (value, { data, id, req, siblingData }) => {
      const tenantOf = async (collection: 'pages' | 'navigation', docId: string) => {
        const doc = await req.payload
          .findByID({ collection, id: docId, depth: 0, overrideAccess: true, req })
          .catch(() => null)
        return relationshipIdOf((doc as { tenant?: unknown } | null)?.tenant as never)
      }
      return validateMenuPageLink(
        {
          linkType: (siblingData as { linkType?: unknown } | undefined)?.linkType,
          page: value,
          tenant: (data as { tenant?: unknown } | undefined)?.tenant,
          menuId: id,
        },
        {
          tenantOfPage: (pageId) => tenantOf('pages', pageId),
          tenantOfMenu: (menuId) => tenantOf('navigation', menuId),
        },
      )
    }) satisfies RelationshipFieldSingleValidation,
  },
  {
    name: 'href',
    type: 'text',
    label: 'Goes to',
    admin: {
      condition: (_data, siblingData) => siblingData?.linkType !== 'page',
      description: 'A path on this site, like /about, or a full web address starting https://',
    },
    // Required for an address only; a page link carries none.
    validate: (value: unknown, { siblingData }: { siblingData?: { linkType?: unknown } }) =>
      siblingData?.linkType === 'page' ? true : validateHref(value, { required: true }),
  },
  {
    name: 'newTab',
    type: 'checkbox',
    defaultValue: false,
    label: 'Open in a new tab',
    admin: {
      description:
        'The link says so out loud when this is on, so people using a screen reader are not moved without warning.',
    },
  },
]

/**
 * `maxRows` is a design constraint, not a technical one. The primary menu is a single flat
 * row that has to survive a 320px viewport and a German or Arabic translation running half
 * again as long (`08` §6); a ninth item is a sign the site's structure needs a section, and
 * `ChildPageNav` is where a section's own pages go.
 */
const menu = (name: string, label: string, description: string, maxRows: number): ArrayField => ({
  name,
  type: 'array',
  label,
  labels: { singular: 'Link', plural: 'Links' },
  maxRows,
  admin: { description },
  fields: linkFields,
})

export const Navigation: CollectionConfig = {
  slug: 'navigation',
  labels: { singular: 'Menus', plural: 'Menus' },
  admin: { group: 'Site' },

  access: {
    read: districtOnly,
    create: districtOnly,
    update: districtOnly,
    delete: districtOnly,
  },

  fields: [
    menu('primary', 'Main menu', 'Across the top of every page. Drag to reorder.', 8),
    menu(
      'utility',
      'Quick links',
      'Small links above the main menu — staff email, the parent portal.',
      6,
    ),
    menu('footer', 'Footer links', 'At the bottom of every page.', 12),
  ],
}
