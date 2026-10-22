import type { CollectionConfig } from 'payload'

import {
  pagesCreateAccess,
  pagesDeleteAccess,
  pagesReadAccess,
  pagesUpdateAccess,
} from '@/access/pages'
import { districtOnlyField } from '@/access/tenant-scoped'
import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'
import {
  deriveSlugFromTitle,
  rootPageCannotBeParent,
  uniqueSlugWithinParent,
} from '@/collections/hooks/page-slug'
import { blockLibrary } from '@/collections/blocks'
import { composedPagesAreDistrictOnly, publishGate } from '@/collections/hooks/publish-gate'
import { applyReviewState } from '@/collections/hooks/review-state'
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
 *   - **A share image.** It is an upload, and `media` is Phase 6. Until then the `meta`
 *     group has no image rather than a URL field that would bypass alt-required-at-upload
 *     (CLAUDE.md rule 7).
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
    /**
     * The school plane's one button (`04` §2.3). Both render Payload's own control for a
     * district admin, so the district plane is unchanged; role-conditional inside the
     * component because these slots are per-collection, not per-user. The school's status
     * line is the `reviewStatus` field below.
     */
    components: {
      edit: {
        PublishButton: '/admin/SendForApproval/SendForApprovalButton#SendForApprovalButton',
        SaveDraftButton: '/admin/SendForApproval/SchoolSaveDraftButton#SchoolSaveDraftButton',
      },
    },
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
   * AUTOSAVE IS ON (`04` §2.3; Jason, 2026-10-21): a changed field saves itself as a draft, so
   * nothing a school manager types is lost to a closed tab. It never publishes — the publish
   * gate sees an ordinary draft write — and it never moves the review state: an autosave on a
   * queued page leaves it queued (`src/access/review-state.ts`).
   *
   * It does not bury the approval diff. Payload updates the latest autosave version in place
   * rather than adding one per keystroke, and the queue diffs the live page against the
   * version the reviewer sees (`04` §4.2), not version against version.
   *
   * `validate: true` IS WHAT MAKES AUTOSAVE SAFE HERE. Without it, Payload's create view makes
   * a page the moment it opens — before anyone types — so every abandoned "new page" left an
   * untitled, slugless draft behind (measured: ~26 per e2e run). With it, a new page saves on
   * its first explicit save and autosaves from then on, and no draft can exist without a
   * title. The school plane's own "new page" flow is where that first save happens.
   */
  versions: {
    drafts: { autosave: true, validate: true },
    maxPerDoc: 50,
  },

  hooks: {
    /**
     * Order matters: derive the slug, then check the DERIVED value for collisions. The
     * parent guard is independent of both and runs last, so a page with two problems reports
     * the slug one first — the field the author was most likely editing.
     */
    beforeValidate: [deriveSlugFromTitle, uniqueSlugWithinParent, rootPageCannotBeParent],
    /**
     * The hook half of two release-blocking gates. The access functions above are the other
     * half; see src/collections/hooks/publish-gate.ts for why one layer is not enough.
     *
     * `applyReviewState` runs LAST: by then a school manager's publishing write has already
     * been refused, so the only publish it ever sees is a district admin's approve.
     */
    beforeChange: [publishGate, composedPagesAreDistrictOnly, applyReviewState],
  },

  fields: [
    {
      /**
       * Where a school manager's change stands — sent, or sent back with the district's note
       * (`04` §2.3). First, so the note sits above the fields it is about. Display only: a `ui`
       * field stores nothing. A district admin has Payload's own status in the header instead.
       */
      name: 'reviewStatus',
      type: 'ui',
      admin: {
        condition: (_data, _siblingData, { user }) => sendsForApproval(user as AuthUser | null),
        components: { Field: '/admin/SendForApproval/ReviewStatusField#ReviewStatusField' },
      },
    },
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
      name: 'layout',
      type: 'blocks',
      blocks: blockLibrary,
      label: 'Sections',
      /**
       * The district-only block array (`03` §3). THREE layers gate it and none is
       * decoration:
       *   - this field-level access, which refuses the write;
       *   - `composedPagesAreDistrictOnly`, which refuses a `layout` payload however it
       *     arrives — including on a partial update that never mentions `pageType`;
       *   - `pagesUpdateAccess`, which refuses the request before either runs.
       * v1 has no school composition (`01` §4.1); enabling it later changes these
       * predicates and nothing else — no new collection, no new block, no new template.
       */
      access: { create: districtOnlyField, update: districtOnlyField },
      admin: {
        /**
         * Hidden on every fixed type. A school manager never reaches this field, but a
         * district admin editing an `about` page should not see an empty block builder
         * below the fields that page actually uses.
         */
        condition: (data: { pageType?: unknown } | undefined) => data?.pageType === 'composed',
        description: 'The sections of this page, top to bottom. Drag to reorder.',
      },
    },
    {
      /**
       * SEO fields (`01` §3 item 13, `03` §2).
       *
       * PLAIN FIELDS, NOT `plugin-seo`, which `02` §2 names. The plugin was installed and
       * measured (2026-09-21): its title and description components hardcode their hint text
       * at `#9A9A9A` on white (2.81:1) and their length pills at white on `red`/`orangered`
       * (3.4–4.0:1), as inline styles, in 3.87.0 and still in 3.90.1. That is a serious axe
       * violation on the admin plane, which non-negotiable rule 6 does not allow, and an inline
       * style leaves nothing to fix it with but `!important` selectors keyed to the plugin's
       * literal colours. `tests/e2e/page-seo-fields.spec.ts` is the axe check that found it.
       *
       * THE GROUP IS NAMED `meta` AND ITS FIELDS `title` / `description` — the plugin's names
       * and stored shape, on purpose. If the plugin fixes its contrast, adopting it is a config
       * change with no migration. `src/content/pages.ts` surfaces the group as `seo`.
       *
       * What the plugin's UI would have added is a character counter and a search-result
       * preview. What actually decides how a page is described is applied at RENDER
       * (`src/lib/seo.ts`): with these empty — the usual case, since school managers log in a
       * few times a year (`04` §2.1) — the title falls back to the page's and the description
       * to its first paragraph.
       *
       * No access restriction: a school-manager may propose SEO text like any other edit, and
       * `04` §4.3 already makes a change to it never auto-approvable.
       */
      name: 'meta',
      type: 'group',
      label: 'Search and sharing',
      admin: {
        description:
          'How this page appears in search results and when its link is shared. Both are optional — leave them empty and the page title and its first paragraph are used.',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
          label: 'Title in search results',
          // Roomier than the ~60 a results page shows: a cap that bites mid-thought reads as
          // broken software. Past this it is not a title.
          maxLength: 70,
          admin: {
            description:
              'Optional. About 50 to 60 characters shows in full. The school name is added to the end for you.',
          },
        },
        {
          name: 'description',
          type: 'textarea',
          label: 'Description in search results',
          maxLength: 200,
          admin: {
            description:
              'Optional. One or two sentences, up to about 160 characters, saying what someone will find on this page.',
          },
        },
      ],
    },
    /**
     * REVIEW STATE (`04` §4.1). All four are owned by `applyReviewState`, which overwrites
     * whatever a request sends for them — see `src/access/review-state.ts` for the
     * transitions. Read-only here: the actions that move them ("Send for approval", approve,
     * request changes) are the Phase 4 admin controls, not fields an editor types into.
     *
     * A `radio`, not a `select`: Payload's select fails the admin axe gate (an unnamed
     * combobox input). No `defaultValue` — null is "nothing pending", and a default would
     * put every district-authored page in a state nobody moved it to.
     */
    {
      name: 'reviewState',
      type: 'radio',
      index: true,
      label: 'Approval',
      options: [
        { label: 'Being edited', value: 'editing' },
        { label: 'Waiting for approval', value: 'submitted' },
        { label: 'Changes requested', value: 'changes-requested' },
      ],
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'reviewNote',
      type: 'textarea',
      label: 'What needs to change',
      admin: {
        readOnly: true,
        position: 'sidebar',
        condition: (data: { reviewState?: unknown } | undefined) =>
          data?.reviewState === 'changes-requested',
      },
    },
    /** When the pending change was first sent — the queue's age and escalation (`04` §5). */
    { name: 'submittedAt', type: 'date', index: true, admin: { hidden: true } },
    /** Who sent it — who is told the outcome (`04` §4.5). */
    { name: 'submittedBy', type: 'relationship', relationTo: 'users', admin: { hidden: true } },
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
