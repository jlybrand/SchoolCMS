import type { ArrayField, CollectionConfig, Field } from 'payload'

import { districtOnly } from '@/access/tenant-scoped'
import { validateHref } from '@/lib/href'

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
    name: 'href',
    type: 'text',
    required: true,
    label: 'Goes to',
    admin: {
      description: 'A path on this site, like /about, or a full web address starting https://',
    },
    validate: (value: unknown) => validateHref(value, { required: true }),
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
