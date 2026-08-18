import type { CollectionConfig } from 'payload'

import {
  pagesCreateAccess,
  pagesDeleteAccess,
  pagesReadAccess,
  pagesUpdateAccess,
} from '@/access/pages'
import { districtOnlyField } from '@/access/tenant-scoped'
import { deriveSlugFromTitle, uniqueSlugWithinParent } from '@/collections/hooks/page-slug'
import { composedPagesAreDistrictOnly, publishGate } from '@/collections/hooks/publish-gate'
import { isReservedSlug, slugify } from '@/lib/slug'

/**
 * `pages` — the first content collection (`03` §2).
 *
 * The `tenant` field is NOT declared here: `@payloadcms/plugin-multi-tenant` injects it for
 * every collection registered with the plugin (see src/payload.config.ts). Declaring it by
 * hand as well would give the collection two tenant fields that disagree.
 *
 * WHAT IS DELIBERATELY ABSENT, and where it lands instead:
 *
 *   - **Body content.** Fixed-type bodies arrive with the constrained rich-text slice
 *     (`07` §4), which is also what wires up the paste normalizer that already exists in
 *     `src/lib/paste-normalizer.ts`.
 *   - **`layout`** — the district-only block array (`03` §3) — arrives with the block
 *     library. `pageType: composed` is already selectable and already gated, so the field
 *     slots into a boundary that is tested before it exists.
 *   - **`seo`.** `plugin-seo` owns that group's shape (`05`); hand-rolling one now would
 *     mean deleting it when the plugin lands.
 *
 * Per CLAUDE.md's TDD exception table, the field declarations here are not test-first —
 * asserting "this field exists" restates the schema. The behaviour attached to them (access
 * functions, hooks, validators) is test-first, and is in `src/access/pages.ts` and
 * `src/collections/hooks/`.
 */
export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'pageType', 'visibility', '_status'],
    /**
     * `04` §2.1 rules out collection-oriented navigation for school users, and the word
     * "collection" with it. This group label is the district plane's; the school plane gets
     * its own verb-shaped root view in Phase 4, which is where school managers will reach
     * pages from.
     */
    group: 'Content',
  },

  access: {
    read: pagesReadAccess,
    create: pagesCreateAccess,
    update: pagesUpdateAccess,
    delete: pagesDeleteAccess,
  },

  /**
   * Drafts and versions (`03` §7). The same mechanism carries pending change requests in
   * Phase 4 — there is deliberately no second draft concept to maintain.
   *
   * Autosave is OFF. With it on, an editor's in-progress typing becomes a version every few
   * seconds, which buries the approval diff (`04` §4.2) in noise and makes "one click from
   * an inline diff" impossible to hit.
   */
  versions: {
    drafts: { autosave: false },
    maxPerDoc: 50,
  },

  hooks: {
    // Order matters: derive the slug, then check the DERIVED value for collisions.
    beforeValidate: [deriveSlugFromTitle, uniqueSlugWithinParent],
    /**
     * The hook half of two release-blocking gates. The access functions above are the other
     * half; see src/collections/hooks/publish-gate.ts for why one layer is not enough.
     */
    beforeChange: [publishGate, composedPagesAreDistrictOnly],
  },

  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: { description: 'What this page is called. Shown as the page heading.' },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description:
          "The page's address, filled in from the title. Changing it changes the URL and breaks existing links.",
      },
      validate: (value: unknown) => {
        if (typeof value !== 'string' || value.trim() === '') {
          return 'Give this page a title so it can have an address.'
        }
        if (slugify(value) !== value) {
          return `The address can only use lowercase letters, numbers and hyphens. Try "${slugify(value)}".`
        }
        if (isReservedSlug(value)) {
          return `"${value}" is reserved by the platform. Please choose a different address.`
        }
        return true
      },
    },
    {
      name: 'body',
      type: 'richText',
      /**
       * Uses the global constrained editor (`07` §4.4) — no per-field override, so the
       * allowlist cannot be widened here without widening it everywhere, visibly.
       *
       * Not required: a `calendar` or `documents` page is a typed listing whose content
       * comes from its module, and forcing prose onto it would invite the "paragraph
       * describing the thing next to the thing" pattern `07` §4.5 exists to reduce.
       */
      admin: { description: 'The words on the page.' },
    },
    {
      name: 'pageType',
      type: 'select',
      required: true,
      defaultValue: 'standard',
      index: true,
      options: [
        { label: 'Standard', value: 'standard' },
        { label: 'About', value: 'about' },
        { label: 'Contact', value: 'contact' },
        { label: 'Staff', value: 'staff' },
        { label: 'Calendar', value: 'calendar' },
        { label: 'Documents', value: 'documents' },
        { label: 'Composed (district only)', value: 'composed' },
      ],
      admin: {
        description:
          'Decides which fields this page offers. "Composed" is the district-only block layout (`03` §2).',
      },
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'pages',
      index: true,
      admin: {
        description: 'Sits this page underneath another one. Drives the URL and the menus.',
      },
      /**
       * Same tenant only. This is a UI convenience, not the isolation guarantee — the
       * access functions and the adversarial suite are that (`02` §4.2) — but without it
       * the picker would list all 28 tenants' pages to a district admin and invite a
       * cross-tenant parent that the renderer could not resolve into a path.
       */
      filterOptions: ({ data }) => {
        const tenant = (data as { tenant?: unknown } | undefined)?.tenant
        return tenant === undefined || tenant === null ? true : { tenant: { equals: tenant } }
      },
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'public',
      index: true,
      options: [
        { label: 'Anyone', value: 'public' },
        { label: 'Staff only', value: 'staff' },
      ],
      admin: {
        description:
          'Staff-only pages never appear on the public site or in the public API (`03` §6.4).',
      },
    },
    {
      name: 'publishAt',
      type: 'date',
      /**
       * District-only at FIELD level, on top of the access functions and the publish-gate
       * hook. A scheduled publish is a publish (CLAUDE.md rule 3) — leaving this open would
       * let a school-manager publish by waiting.
       */
      access: { create: districtOnlyField, update: districtOnlyField },
      admin: {
        description: 'Optional. Goes live at this time instead of immediately.',
        position: 'sidebar',
      },
    },
    {
      name: 'requiresTranslationReview',
      type: 'checkbox',
      defaultValue: false,
      /**
       * Gates locale publication for high-stakes content (`08` §7.1). Whether a page needs
       * human translation verification is a district judgement, not a school one.
       */
      access: { create: districtOnlyField, update: districtOnlyField },
      admin: {
        description: 'Hold translations of this page until a person has checked them.',
        position: 'sidebar',
      },
    },
  ],
}
