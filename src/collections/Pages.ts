import type { CollectionConfig } from 'payload'
import { textImagesAreThisSites } from '@/collections/hooks/text-images'

import {
  pagesCreateAccess,
  pagesDeleteAccess,
  pagesReadAccess,
  pagesReadVersionsAccess,
  pagesUpdateAccess,
} from '@/access/pages'
import { isDistrictAdmin, isSchoolManager } from '@/access/predicates'
import { schoolPalette } from '@/access/school-layout'
import { districtOnlyField } from '@/access/tenant-scoped'
import type { AuthUser } from '@/access/types'
import { documentReviewField } from '@/admin/Approvals/document-review-field'
import { PREVIEW_BREAKPOINTS } from '@/admin/LivePreview/device-tabs'
import { changeCommentField } from '@/collections/fields/change-comment'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'
import {
  deriveSlugFromTitle,
  freeSlugForCopy,
  rootPageCannotBeParent,
  uniqueSlugWithinParent,
} from '@/collections/hooks/page-slug'
import { blockLibrary } from '@/collections/blocks'
import { auditChange, auditDelete } from '@/collections/hooks/audit'
import { validateLinkMode } from '@/collections/hooks/linked-page'
import { restoreIsDistrictOnly } from '@/collections/hooks/page-history'
import { publishGate, schoolLayoutGate } from '@/collections/hooks/publish-gate'
import { pageDatesHook } from '@/collections/hooks/scheduled-dates'
import { makeApproveEndpoint } from '@/collections/endpoints/approve'
import { applyReviewState } from '@/collections/hooks/review-state'
import {
  makeNotifyReviewOutcome,
  pagePath,
  schoolOf,
  sendWithPayload,
  userEmail,
} from '@/collections/hooks/notify-review-outcome'
import {
  makeRevalidateOnPublish,
  liveStillPublished,
  pageRevalidationTargets,
  tenantHostname,
} from '@/collections/hooks/revalidate-on-publish'
import { settingClass } from '@/admin/PageToolbar/page-settings'
import { PERMALINK_SEGMENT } from '@/lib/permalink'
import { isReservedSlug, isReservedTopLevelSlug, slugify } from '@/lib/slug'
import { siteNameField } from '@/collections/fields/site-name'

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
/** Who may write a page's components at all: the district, and school managers (Jason, 2026-11-04). */
const composesField = ({ req }: { req: { user?: unknown } }): boolean => {
  const user = (req.user as AuthUser | null) ?? null
  return isDistrictAdmin(user) || isSchoolManager(user)
}

export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: {
    /**
     * Live Preview (Jason, 2026-11-10): the page as it will look, beside the form, following the
     * editor's typing on each autosave. The route reads the draft as the signed-in person —
     * see `src/app/(preview)/admin-preview/pages/[id]/page.tsx`. A page not yet saved has no id
     * and so no preview.
     */
    livePreview: {
      url: ({ data }) => (data?.id ? `/admin-preview/pages/${String(data.id)}` : null),
      // Mobile, Tablet, Desktop — shown as tabs with Payload's Responsive (2026-11-12).
      breakpoints: PREVIEW_BREAKPOINTS.map((b) => ({ ...b })),
    },
    useAsTitle: 'title',
    defaultColumns: ['title', 'linkMode', 'slug', 'visibility', '_status'],
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
      /**
       * History: the publishes of the last year, each opening its version (Jason, 2026-11-12) —
       * in place of Payload's list of every version. See `src/admin/History/`.
       */
      views: {
        edit: {
          versions: {
            Component: '/admin/History/HistoryView#HistoryView',
            // No count: Payload's counts every version, not the publishes History lists.
            tab: { label: 'History', Pill: '/admin/History/NoPill#NoPill' },
          },
        },
      },
      /** A school manager's way to create from the list (Jason, 2026-11-04) — see the component. */
      beforeListTable: [
        {
          path: '/admin/SchoolPlane/ListTaskButton#ListTaskButton',
          clientProps: { collection: 'pages' },
        },
      ],
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
    readVersions: pagesReadVersionsAccess,
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
   *
   * A SECTION'S fields are the exception (Jason, 2026-11-19): they pass the edit check and an
   * autosave, so adding an empty section shows no error until Publish or Send for approval,
   * which check them in full (`src/lib/defer-section-validation.ts`).
   */
  versions: {
    drafts: { autosave: true, validate: true },
    /**
     * Every version kept (Jason, 2026-11-12: "keep as much page/post history as possible"), so a
     * publish in History can always be opened and restored. Autosave updates its newest version
     * rather than adding one per keystroke, so this grows by editing sessions, not keystrokes.
     */
    maxPerDoc: 0,
  },

  hooks: {
    /** Restoring a past version is the district's — see the hook for why access is not enough. */
    beforeOperation: [restoreIsDistrictOnly],
    /**
     * Order matters: derive the slug, then check the DERIVED value for collisions. The
     * parent guard is independent of both and runs last, so a page with two problems reports
     * the slug one first — the field the author was most likely editing.
     */
    beforeValidate: [
      deriveSlugFromTitle,
      uniqueSlugWithinParent,
      rootPageCannotBeParent,
      // An image in the words is this site's (Jason, 2026-11-19).
      textImagesAreThisSites,
    ],
    /**
     * The hook half of two release-blocking gates. The access functions above are the other
     * half; see src/collections/hooks/publish-gate.ts for why one layer is not enough.
     *
     * `applyReviewState` runs LAST: by then a school manager's publishing write has already
     * been refused, so the only publish it ever sees is a district admin's approve.
     */
    /** The Start FIRST: a publish with one still to come becomes a schedule before the gate. */
    beforeChange: [pageDatesHook, publishGate, schoolLayoutGate, applyReviewState],
    /**
     * A publish goes live in seconds, not at the next hourly ISR (`05` Phase 4 exit). Next's
     * `revalidatePath` is imported lazily: this config also loads outside Next (the seed, the
     * integration suite), where the hook logs and moves on.
     */
    afterChange: [
      /** FIRST: the audit entry is in the change's transaction; a failed write fails the change. */
      auditChange('pages'),
      makeRevalidateOnPublish({
        revalidate: async (path, type) => {
          const { revalidatePath } = await import('next/cache')
          revalidatePath(path, type)
        },
        hostnameFor: tenantHostname,
        // Its own site, and every site with a linked page pointing at it.
        targetsFor: pageRevalidationTargets,
        // An unpublish takes the page off the site now (Jason, 2026-10-29).
        stillLive: liveStillPublished('pages'),
      }),
      /** The submitter's email on approve or request changes (`04` §4.5). */
      makeNotifyReviewOutcome({
        collection: 'pages',
        send: sendWithPayload,
        serverUrl: process.env.NEXT_PUBLIC_SERVER_URL ?? '',
        recipientFor: userEmail,
        schoolFor: schoolOf,
        pathFor: pagePath,
      }),
    ],
    afterDelete: [auditDelete('pages')],
  },

  /** The approval queue's one click — see the file for why it is not a plain PATCH. */
  endpoints: [makeApproveEndpoint('pages')],

  fields: [
    // Which site this is on, for the district (Jason, 2026-11-18) — see `siteNameField`.
    siteNameField(),
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
    /** The district's review — diff, Approve, Request changes — on the page itself (2026-11-12). */
    documentReviewField,
    /** The optional comment sent with a publish, schedule or send — never stored (2026-11-12). */
    changeCommentField,
    {
      /**
       * Live Preview's device tabs (Jason, 2026-11-12): draws nothing here, and puts Mobile,
       * Tablet, Desktop and Responsive in the preview's toolbar. See `src/admin/LivePreview/`.
       */
      name: 'previewDevices',
      type: 'ui',
      admin: { components: { Field: '/admin/LivePreview/DeviceTabs#DeviceTabs' } },
    },
    {
      /**
       * The Page settings dialog's heading and Close (Jason, 2026-10-29) — first, so it heads the
       * dialog. Shown only inside it; the district's only. See `src/admin/PageToolbar/`.
       */
      name: 'pageSettingsHeader',
      type: 'ui',
      admin: {
        condition: (_data, _siblingData, { user }) => !sendsForApproval(user as AuthUser | null),
        components: { Field: '/admin/PageToolbar/PageSettingsHeader#PageSettingsHeader' },
      },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: {
        className: settingClass('page'),
        description: 'What this page is called. Shown as the page heading.',
      },
      // A clone says it is one (the page toolbar's Clone, Jason 2026-10-29).
      hooks: {
        beforeDuplicate: [({ value }) => (typeof value === 'string' ? `${value} (copy)` : value)],
      },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      index: true,
      // A clone takes a free address beside the original — see `freeSlugForCopy`.
      hooks: { beforeDuplicate: [freeSlugForCopy] },
      admin: {
        className: settingClass('page'),
        description:
          "The page's address, filled in from the title. Links chosen as pages, menus and the permanent link follow a change; addresses typed by hand and links from other websites do not.",
      },
      validate: (value: unknown, { siblingData }: { siblingData?: { parent?: unknown } }) => {
        if (typeof value !== 'string' || value.trim() === '') {
          return 'Give this page a title so it can have an address.'
        }
        if (slugify(value) !== value) {
          return `The address can only use lowercase letters, numbers and hyphens. Try "${slugify(value)}".`
        }
        if (isReservedSlug(value)) {
          return `"${value}" is reserved by the platform. Please choose a different address.`
        }
        // `/news` is the site's announcement list (Jason, 2026-10-28) — at the top level only.
        const topLevel = siblingData?.parent === undefined || siblingData.parent === null
        if (topLevel && isReservedTopLevelSlug(value)) {
          return value === PERMALINK_SEGMENT
            ? `"${value}" is reserved for permanent page links. Please choose a different address, or place this page under another one.`
            : `"${value}" is where this site's announcements are listed. Please choose a different address, or place this page under another one.`
        }
        return true
      },
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'pages',
      index: true,
      admin: {
        className: settingClass('page'),
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
      // A radio, not a select: Payload's select input fails axe (`docs/phases/04` §17).
      type: 'radio',
      required: true,
      defaultValue: 'public',
      index: true,
      options: [
        { label: 'Anyone', value: 'public' },
        { label: 'Staff only', value: 'staff' },
      ],
      admin: {
        className: settingClass('access'),
        description:
          'Staff-only pages never appear on the public site or in the public API (`03` §6.4).',
      },
    },
    {
      /**
       * The page's permanent link, `/dd2/pages/<id>` (Jason, 2026-10-29). Display only — a `ui` field
       * stores nothing; the route that answers it is `src/app/(frontend)/sites/[hostname]/
       * [locale]/dd2/pages/[id]/route.ts`.
       */
      name: 'permalink',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: { Field: '/admin/Permalink/PermalinkField#PermalinkField' },
      },
    },
    /**
     * PAGE OPTIONS (Jason, 2026-10-29) — Finalsite's "hide from navigation elements" and "hide
     * from external search engines". The district's: field-level access refuses a school
     * manager's write, and the condition keeps them off the school plane, where the usability
     * bar has no room for them (`04` §2.1).
     *
     * Hidden from navigation: left out of the section menus built from the page tree (its
     * parent's child list, `ChildPageNav`). Still at its address, still in the sitemap, and a
     * menu link the district added by hand still shows — that was chosen, not built.
     *
     * Hidden from search engines: `noindex` on the page and left out of the sitemap; its links
     * are still followed. Hidden from site search (2026-11-11) is stored now; the site's own
     * search that honours it is Phase 6's.
     *
     * In the main column since the Page settings tabs (2026-11-11), not the sidebar, so every
     * setting sits in the one element the dialog makes its tab panel. A school never sees them.
     */
    /**
     * LINKED PAGE (Jason, 2026-10-29) — Finalsite's "Linked" setting. An internal redirect sends
     * the visitor to another page: one on this site, or a district page. Never an outside
     * address. Two pickers, not one, because a picker shows only titles and every site has an
     * "About": the district picker lists district pages only.
     *
     * The district's, as the page options below are. The rules are `src/lib/linked-page.ts`,
     * checked on save by `validateLinkMode`; the redirect itself is the page route's.
     */
    {
      name: 'linkMode',
      type: 'radio',
      defaultValue: 'none',
      label: 'Linked page',
      options: [
        { label: 'Not linked', value: 'none' },
        { label: 'Send visitors to another page', value: 'redirect' },
        // Jason, 2026-10-29: the district page's title and content, at this page's address.
        { label: "Show a district page's content here", value: 'reuse' },
      ],
      access: { create: districtOnlyField, update: districtOnlyField },
      validate: validateLinkMode,
      admin: {
        className: settingClass('linking'),
        condition: (_data, _siblingData, { user }) => !sendsForApproval(user as AuthUser | null),
        description: 'A linked page has no content of its own.',
        components: {
          Cell: '/admin/LinkedPage/LinkedPageCell#LinkedPageCell',
          // A checkbox, then the kind as pills (Jason, 2026-11-11). Same stored value.
          Field: '/admin/LinkedPage/LinkModeField#LinkModeField',
        },
      },
    },
    {
      name: 'linkTo',
      type: 'radio',
      defaultValue: 'site',
      label: 'Which page',
      options: [
        { label: 'A page on this site', value: 'site' },
        { label: 'A district page', value: 'district' },
      ],
      access: { create: districtOnlyField, update: districtOnlyField },
      admin: {
        className: settingClass('linking'),
        condition: (data, _siblingData, { user }) =>
          !sendsForApproval(user as AuthUser | null) && data?.linkMode === 'redirect',
      },
    },
    {
      name: 'linkTarget',
      type: 'relationship',
      relationTo: 'pages',
      label: 'Page on this site',
      access: { create: districtOnlyField, update: districtOnlyField },
      admin: {
        className: settingClass('linking'),
        condition: (data, _siblingData, { user }) =>
          !sendsForApproval(user as AuthUser | null) &&
          data?.linkMode === 'redirect' &&
          data?.linkTo !== 'district',
      },
    },
    {
      name: 'districtLinkTarget',
      type: 'relationship',
      relationTo: 'pages',
      label: 'District page',
      access: { create: districtOnlyField, update: districtOnlyField },
      /**
       * District pages only — reached across sites, see src/lib/cross-tenant-relationships.ts.
       * The filter is put back in place of the tenant plugin's "this site only".
       */
      custom: { crossTenant: true, filterOptions: { 'tenant.type': { equals: 'district' } } },
      admin: {
        className: settingClass('linking'),
        condition: (data, _siblingData, { user }) =>
          !sendsForApproval(user as AuthUser | null) &&
          (data?.linkMode === 'reuse' ||
            (data?.linkMode === 'redirect' && data?.linkTo === 'district')),
      },
    },
    {
      name: 'hideFromNavigation',
      type: 'checkbox',
      defaultValue: false,
      label: 'Hide from navigation',
      access: { create: districtOnlyField, update: districtOnlyField },
      admin: {
        className: settingClass('page'),
        condition: (_data, _siblingData, { user }) => !sendsForApproval(user as AuthUser | null),
        description: 'Leaves this page out of section menus. Its address still works.',
      },
    },
    {
      /**
       * Hidden from the site's OWN search (Jason, 2026-11-11), beside "hide from search engines",
       * which is Google's. Stored and carried by the content layer now; the site search that
       * honours it is Phase 6's. Neither option implies the other.
       */
      name: 'hideFromSiteSearch',
      type: 'checkbox',
      defaultValue: false,
      label: 'Hide from site search',
      access: { create: districtOnlyField, update: districtOnlyField },
      admin: {
        className: settingClass('page'),
        condition: (_data, _siblingData, { user }) => !sendsForApproval(user as AuthUser | null),
        description: "Leaves this page out of this website's own search results.",
      },
    },
    {
      name: 'hideFromSearchEngines',
      type: 'checkbox',
      defaultValue: false,
      label: 'Hide from search engines',
      access: { create: districtOnlyField, update: districtOnlyField },
      admin: {
        className: settingClass('page'),
        condition: (_data, _siblingData, { user }) => !sendsForApproval(user as AuthUser | null),
        description:
          'Asks Google and others not to list this page. Anyone with the link can still visit it.',
      },
    },
    {
      name: 'publishAt',
      type: 'date',
      // A clone is not scheduled: going live at the original's time is a surprise nobody chose.
      hooks: { beforeDuplicate: [() => null] },
      label: 'Start',
      /**
       * District-only at FIELD level, on top of the access functions and the publish-gate
       * hook. A scheduled publish is a publish (CLAUDE.md rule 3) — leaving this open would
       * let a school-manager publish by waiting. READ too (Jason, 2026-11-04): a school's form that
       * held the Start would send it back on save, which page access refuses as publishing.
       *
       * Acted on since 2026-11-04: publishing with a Start still to come schedules the page
       * (`pageDatesHook`), and the schedule job puts it live (`src/collections/endpoints/schedule.ts`).
       */
      access: { read: districtOnlyField, create: districtOnlyField, update: districtOnlyField },
      /**
       * Chosen when publishing since 2026-11-11 (Jason): "Publish now" or "Schedule…" in the
       * header (`src/admin/PagePublish/`), so the field itself is hidden. Still in the form
       * state, which is where that control reads the scheduled time from.
       */
      admin: {
        hidden: true,
        condition: (_data, _siblingData, { user }) => !sendsForApproval(user as AuthUser | null),
      },
    },
    {
      // The dialog's "Done", after its last setting.
      name: 'pageSettingsFooter',
      type: 'ui',
      admin: {
        position: 'sidebar',
        condition: (_data, _siblingData, { user }) => !sendsForApproval(user as AuthUser | null),
        components: { Field: '/admin/PageToolbar/PageSettingsHeader#PageSettingsFooter' },
      },
    },
    {
      name: 'layout',
      type: 'blocks',
      blocks: blockLibrary,
      label: 'Sections',
      // "Add Section", not Payload's "Add Layout" from the field's name.
      labels: { singular: 'Section', plural: 'Sections' },
      /**
       * The page's components (`03` §3). Schools compose too since 2026-11-04 (Jason, "level
       * B"): with the simple components, around the district's, which they cannot change. The
       * layers, none decoration:
       *   - this field's access: district and school managers only — never a non-human actor;
       *   - `filterOptions`: a school's picker offers the simple components (`schoolPalette`);
       *   - `schoolLayoutGate`, which judges every write against the STORED layout, however it
       *     arrives (admin, REST, GraphQL) — the rule itself is `checkSchoolLayout`;
       *   - `pagesUpdateAccess`, tenant-scoped, before any of it runs.
       */
      access: { create: composesField, update: composesField },
      filterOptions: ({ siblingData, user }) =>
        sendsForApproval(user as AuthUser | null)
          ? schoolPalette((siblingData as { layout?: unknown } | undefined)?.layout)
          : true,
      admin: {
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
       * literal colors. `tests/e2e/page-seo-fields.spec.ts` is the axe check that found it.
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
        className: settingClass('seo'),
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
    {
      /**
       * The district's page toolbar (Jason, 2026-10-29): History, Clone, Delete, Unpublish and the
       * gear that opens Page settings, along the bottom of the page. Last in the form, so it
       * follows the contents. See `src/admin/PageToolbar/PageToolbar.tsx`.
       */
      name: 'pageToolbar',
      type: 'ui',
      admin: {
        condition: (_data, _siblingData, { user }) => !sendsForApproval(user as AuthUser | null),
        components: { Field: '/admin/PageToolbar/PageToolbar#PageToolbar' },
      },
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
        { label: 'Scheduled to go live', value: 'scheduled' },
      ],
      // A clone starts fresh: it has not been sent, approved or scheduled (its Start is cleared too).
      hooks: { beforeDuplicate: [() => null] },
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
