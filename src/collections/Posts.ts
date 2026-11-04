import type { CollectionConfig, Field } from 'payload'

import {
  postsCreateAccess,
  postsDeleteAccess,
  postsReadAccess,
  postsReadVersionsAccess,
  postsUpdateAccess,
} from '@/access/posts'
import { districtOnlyField } from '@/access/tenant-scoped'
import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'
import { makeApproveEndpoint } from '@/collections/endpoints/approve'
import { auditChange, auditDelete } from '@/collections/hooks/audit'
import { autoApprovePost } from '@/collections/hooks/auto-approve'
import {
  makeNotifyReviewOutcome,
  schoolOf,
  sendWithPayload,
  userEmail,
} from '@/collections/hooks/notify-review-outcome'
import { revalidatePost } from '@/collections/hooks/revalidate-on-publish'
import { postPath } from '@/lib/post-url'
import { restoreIsDistrictOnly } from '@/collections/hooks/page-history'
import { deriveSlugFromTitle } from '@/collections/hooks/page-slug'
import {
  boardIsThisSchools,
  postNeedsWordsHook,
  stampPublishedDateHook,
  uniquePostSlug,
} from '@/collections/hooks/post-hooks'
import { postDatesHook } from '@/collections/hooks/scheduled-dates'
import { publishGate } from '@/collections/hooks/publish-gate'
import { applyReviewState } from '@/collections/hooks/review-state'
import { SYNDICATION_SCOPES } from '@/content/syndication'
import { slugify } from '@/lib/slug'

/**
 * `posts` — news and announcements (`03` §2), the first Phase 5 module.
 *
 * Built on the same machinery as `pages`, deliberately: the same publish gate, the same
 * review-state machine, the same audit hooks, drafts with autosave. A school manager's post
 * goes through approval exactly as a page does (`04` §4.1).
 *
 * As with pages, `tenant` is injected by `plugin-multi-tenant` (src/payload.config.ts).
 *
 * DELIBERATELY ABSENT, and where each lands:
 *
 *   - **`heroImage`.** An upload, and `media` is Phase 6 — the same reason pages have no share
 *     image yet (CLAUDE.md rule 7).
 *   - **`category`.** `03` §2 names the field but not its values, and a fixed list is a
 *     taxonomy DD2 has not chosen. Open with the template census (`10` §2); it is a nullable
 *     column to add, not a migration to undo.
 *   - **Revalidation.** Nothing renders a post yet. The public template and `FeedBlock` bring
 *     it, with the syndication fan-out `src/lib/cache-tags.ts` already describes.
 *   - **The approval queue, the school task, the outcome emails.** Pages-only today; posts
 *     join them in the next slice. Until then a school manager has no route to a post.
 *
 * Field declarations are not test-first (CLAUDE.md's exception table); the access functions
 * and hooks attached to them are.
 */
/**
 * One of the announcement's dates: day and time, in the sidebar. District only for READ as well,
 * like `syndication`: a school's form then never holds a date, so a school's save never carries
 * one back — which post access would refuse as publishing (`isPublishingWrite`).
 */
const dateField = (name: string, label: string, description: string): Field => ({
  name,
  type: 'date',
  label,
  index: true,
  access: { read: districtOnlyField, create: districtOnlyField, update: districtOnlyField },
  admin: {
    description,
    position: 'sidebar',
    date: { pickerAppearance: 'dayAndTime' },
    condition: (_data, _siblingData, { user }) => !sendsForApproval(user as AuthUser | null),
  },
})

export const Posts: CollectionConfig = {
  slug: 'posts',
  labels: { singular: 'Announcement', plural: 'News and announcements' },
  /** Named for the slug, not the labels — GraphQL would otherwise derive `NewsAndAnnouncements`. */
  graphQL: { singularName: 'Post', pluralName: 'Posts' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'publishedDate', 'visibility', '_status'],
    group: 'Content',
    /** The school plane's one button, as on pages (`04` §2.3). */
    components: {
      /**
       * Folders → boards → a board's posts, with "Create post" (Jason, 2026-11-04) — Finalsite's
       * Posts module, for both planes. See src/admin/Announcements/.
       */
      views: { list: { Component: '/admin/Announcements/AnnouncementsView#AnnouncementsView' } },
      edit: {
        PublishButton: '/admin/SendForApproval/SendForApprovalButton#SendForApprovalButton',
        SaveDraftButton: '/admin/SendForApproval/SchoolSaveDraftButton#SchoolSaveDraftButton',
      },
    },
  },

  access: {
    read: postsReadAccess,
    create: postsCreateAccess,
    update: postsUpdateAccess,
    delete: postsDeleteAccess,
    readVersions: postsReadVersionsAccess,
  },

  /** As pages — see src/collections/Pages.ts for why `validate: true` makes autosave safe. */
  versions: {
    drafts: { autosave: true, validate: true },
    maxPerDoc: 50,
  },

  hooks: {
    beforeOperation: [restoreIsDistrictOnly],
    /** Derive the slug from the title, then make it this school's own. */
    beforeValidate: [deriveSlugFromTitle, uniquePostSlug, boardIsThisSchools],
    /**
     * The publish gate first, the review state last — the order pages use, for its reason.
     * `postNeedsWordsHook` reads the REQUESTED review state, so it runs before
     * `applyReviewState` replaces it with the resolved one.
     */
    /** The dates FIRST: a publish with a future Start becomes a schedule before the gate sees it. */
    beforeChange: [
      postDatesHook,
      publishGate,
      postNeedsWordsHook,
      stampPublishedDateHook,
      applyReviewState,
    ],
    afterChange: [
      /** FIRST, as on pages: the entry is in the change's transaction. */
      auditChange('posts'),
      /**
       * Live in seconds on EVERY site that lists it — its own and each it is shared with, before
       * and after this write (`syndicationTargets`), so a site it was taken off stops listing it.
       */
      revalidatePost,
      /** The submitter's email on approve or request changes (`04` §4.5). */
      makeNotifyReviewOutcome({
        collection: 'posts',
        send: sendWithPayload,
        serverUrl: process.env.NEXT_PUBLIC_SERVER_URL ?? '',
        recipientFor: userEmail,
        schoolFor: schoolOf,
        pathFor: async (doc) => postPath(String(doc.slug)),
      }),
      /**
       * LAST: a send covered by a district grant publishes here, in the send's transaction, after
       * the send's own audit entry (`04` §4.3; `posts.routine`).
       */
      autoApprovePost,
    ],
    afterDelete: [auditDelete('posts')],
  },

  /** The queue's one click, as on pages. */
  /** Approve, with optional dates (`src/collections/endpoints/approve.ts`). */
  endpoints: [makeApproveEndpoint('posts')],

  fields: [
    {
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
      admin: { description: 'The headline. Shown above the announcement and in news lists.' },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description:
          "The announcement's address, filled in from the headline. Changing it breaks existing links.",
        position: 'sidebar',
      },
      validate: (value: unknown) => {
        if (typeof value !== 'string' || value.trim() === '') {
          return 'Give this announcement a headline so it can have an address.'
        }
        if (slugify(value) !== value) {
          return `The address can only use lowercase letters, numbers and hyphens. Try "${slugify(value)}".`
        }
        return true
      },
    },
    {
      /**
       * Where the announcement is filed (Jason, 2026-10-28): one board, of the post's own site
       * — `boardIsThisSchools` refuses another's. Organises and filters; it never decides who
       * sees the post. That is `syndication`.
       */
      name: 'board',
      type: 'relationship',
      relationTo: 'post-boards',
      required: true,
      label: 'Board',
      filterOptions: ({ data }) => {
        const tenant = (data as { tenant?: unknown } | undefined)?.tenant
        return tenant === undefined || tenant === null ? true : { tenant: { equals: tenant } }
      },
      admin: { description: 'Which of the school’s boards this goes on.' },
    },
    {
      /** The district-wide list (`post-tags`). Not sortable: order means nothing, and a sortable
       * chip nests buttons (axe, as `syndicatedTo`). */
      name: 'tags',
      type: 'relationship',
      relationTo: 'post-tags',
      hasMany: true,
      label: 'Tags',
      admin: {
        isSortable: false,
        description: 'Optional. Lets news lists that show only, say, "High" find this.',
      },
    },
    {
      name: 'excerpt',
      type: 'textarea',
      label: 'Summary',
      maxLength: 300,
      admin: {
        description:
          'Optional. One or two sentences shown in news lists. Leave it empty and the first paragraph is used.',
      },
    },
    {
      /**
       * The global constrained editor (`07` §4.4), as on pages — no per-field override.
       * Not `required`: words are required when the post is sent or published
       * (`postNeedsWords`), so it can be created from its headline first.
       */
      name: 'body',
      type: 'richText',
      admin: { description: 'The announcement itself.' },
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
        description:
          'Staff-only announcements never appear on the public site or in the public API (`03` §6.4).',
      },
    },
    {
      /**
       * The date the post shows, filled in on first publish (`stampPublishedDate`). Display
       * only — it never holds a post back, so it is not a scheduled publish — and district-only,
       * so a school cannot pin its post to the top of a feed with a date in the future.
       */
      name: 'publishedDate',
      type: 'date',
      index: true,
      access: { create: districtOnlyField, update: districtOnlyField },
      admin: {
        description: 'Filled in when the announcement is first published.',
        position: 'sidebar',
        // Hidden from the school, who cannot set it: a read-only date talking about publishing
        // is exactly the draft-versus-published concept `04` §2.1 keeps off their screen.
        condition: (_data, _siblingData, { user }) => !sendsForApproval(user as AuthUser | null),
      },
    },
    /**
     * The announcement's dates (Jason, 2026-11-04) — rules in `src/lib/post-dates.ts`, applied by
     * `postDatesHook`, run by `src/jobs/post-schedule.ts`. District only at FIELD level, and out of
     * a school's sight: a Start would let a school publish by waiting (`isPublishingWrite`). The
     * district usually sets them when approving, in the queue.
     */
    dateField('publishAt', 'Start', 'Optional. Goes live at this time instead of now.'),
    dateField(
      'expiresAt',
      'Expires',
      'Optional. Taken off the website at this time — unpublished, not deleted.',
    ),
    dateField(
      'featuredUntil',
      'Featured until',
      'Optional. Listed first in news lists and feeds until this time.',
    ),
    {
      /**
       * COPE syndication (`02` §6) — which other sites show this post. District-only at FIELD
       * level, for read too: `04` §2.7 lists syndication among what a school manager cannot do,
       * and a control they cannot use is one more thing on their screen. A value they send is
       * dropped, not refused, so a school editing a post the district shared does not fail.
       *
       * Unset reads as `this-tenant` (`src/content/syndication.ts`), so a post a school created
       * — where this field was never written — reaches only that school.
       */
      name: 'syndication',
      type: 'group',
      label: 'Where this appears',
      access: { read: districtOnlyField, create: districtOnlyField, update: districtOnlyField },
      admin: { position: 'sidebar' },
      fields: [
        {
          name: 'scope',
          type: 'radio',
          defaultValue: 'this-tenant',
          options: SYNDICATION_SCOPES.map(({ value, label }) => ({ value, label })),
        },
        {
          name: 'syndicatedTo',
          type: 'relationship',
          relationTo: 'tenants',
          hasMany: true,
          label: 'Sites',
          admin: {
            /**
             * Not sortable: the order of the sites means nothing, and a sortable chip is a
             * `role="button"` wrapped round its own edit and remove buttons — nested
             * interactive controls, a serious axe violation (`docs/phases/04` §17).
             */
            isSortable: false,
            condition: (_data, sibling: { scope?: unknown } | undefined) =>
              sibling?.scope === 'selected',
            description: 'The other sites that show this announcement.',
          },
        },
      ],
    },
    /** REVIEW STATE (`04` §4.1) — the four fields pages carry, owned by `applyReviewState`. */
    {
      name: 'reviewState',
      type: 'radio',
      index: true,
      label: 'Approval',
      options: [
        { label: 'Being edited', value: 'editing' },
        { label: 'Waiting for approval', value: 'submitted' },
        { label: 'Changes requested', value: 'changes-requested' },
        { label: 'Approved, goes live at its Start', value: 'scheduled' },
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
    { name: 'submittedAt', type: 'date', index: true, admin: { hidden: true } },
    { name: 'submittedBy', type: 'relationship', relationTo: 'users', admin: { hidden: true } },
    {
      name: 'requiresTranslationReview',
      type: 'checkbox',
      defaultValue: false,
      access: { create: districtOnlyField, update: districtOnlyField },
      admin: {
        description: 'Hold translations of this announcement until a person has checked them.',
        position: 'sidebar',
      },
    },
  ],
}
