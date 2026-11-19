import type { CollectionConfig } from 'payload'
import { textImagesAreThisSites } from '@/collections/hooks/text-images'

import {
  eventsCreateAccess,
  eventsDeleteAccess,
  eventsReadAccess,
  eventsReadVersionsAccess,
  eventsUpdateAccess,
} from '@/access/events'
import { auditChange, auditDelete } from '@/collections/hooks/audit'
import {
  eventCalendarIsThisSites,
  eventDatesHook,
  unlessFeedSync,
} from '@/collections/hooks/event-hooks'
import { restoreIsDistrictOnly } from '@/collections/hooks/page-history'
import { revalidateEvent } from '@/collections/hooks/revalidate-on-publish'
import { REPEAT_OPTIONS } from '@/lib/recurrence'
import { siteNameField } from '@/collections/fields/site-name'

/**
 * `events` — calendar events (`03` §2; Jason, 2026-11-11: "the same fields as Finalsite calendar
 * events").
 *
 * THE FIELDS ARE FINALSITE'S CALENDAR MANAGER FORM, AS DD2 USES IT: title, start and end (the end
 * may be blank), all day, location, repeat (Finalsite's choices) and Notes — which a reader sees
 * when they click the event. Left out, each for a reason:
 *
 *   - **Description.** Finalsite has both Notes and Description; DD2's Notes is the text shown on
 *     click, which is what Description did. One field, not two that mean nearly the same.
 *   - **Priority** and the **survey form**. Not used; forms are MS Forms embeds (`01` §5).
 *   - **More than one calendar.** Finalsite allows it; nobody used it (Jason, 2026-10-28).
 *   - `03` §2's `category`, `syndication` and `agendaBody`: the calendar is the category (as
 *     boards replaced it for posts), the calendar block decides reach, and Notes is the
 *     constrained rich text a pasted agenda lands in (the paste normalizer applies, `07` §4).
 *
 * NO APPROVAL (Jason, 2026-11-11). A school manager adds one with "Add an event"
 * (`/admin/new-event`), fills in the rest here and puts it on the calendar with "Save to the
 * calendar" — no queue, no email. They change and remove their own school's events the same way.
 * The district sees each in the activity log (`auditChange`). Access is in `src/access/events.ts`,
 * which says which rules this lifts and why; there is deliberately no publish gate and no review
 * state here.
 *
 * Drafts with autosave, as pages, so an event being written is not on the calendar until it is
 * saved there. `tenant` is injected by `plugin-multi-tenant` (src/payload.config.ts).
 *
 * NOT HERE YET: an event's own page and the iCal subscribe link; feed calendars.
 *
 * Field declarations are not test-first (CLAUDE.md's exception table); the access functions and
 * hooks attached to them are.
 */
export const Events: CollectionConfig = {
  slug: 'events',
  labels: { singular: 'Event', plural: 'Events' },
  graphQL: { singularName: 'Event', pluralName: 'Events' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'start', 'calendar', '_status'],
    group: 'Content',
    components: {
      /** A school manager's "Add an event" on the list, as Pages has "Add a page". */
      beforeListTable: [
        /** Whose calendar this list is, when it is one calendar's (Jason, 2026-11-18). */
        '/admin/SiteName/EventsListHeading#EventsListHeading',
        {
          path: '/admin/SchoolPlane/ListTaskButton#ListTaskButton',
          clientProps: { collection: 'events' },
        },
      ],
      edit: {
        /** Payload's publish, worded for a school ("Save to the calendar"). */
        PublishButton: '/admin/Events/EventSaveButton#EventSaveButton',
        /** One button for a school: autosave covers the rest, as on pages. */
        SaveDraftButton: '/admin/SendForApproval/SchoolSaveDraftButton#SchoolSaveDraftButton',
      },
    },
  },

  access: {
    read: eventsReadAccess,
    create: eventsCreateAccess,
    update: eventsUpdateAccess,
    delete: eventsDeleteAccess,
    readVersions: eventsReadVersionsAccess,
  },

  /** As pages — see src/collections/Pages.ts for why `validate: true` makes autosave safe. */
  versions: {
    drafts: { autosave: true, validate: true },
    maxPerDoc: 50,
  },

  hooks: {
    beforeOperation: [restoreIsDistrictOnly],
    /** The site's own calendar when none is chosen, and never another site's. */
    beforeValidate: [eventCalendarIsThisSites, textImagesAreThisSites],
    /** The dates, so a refusal names the field. No publish gate: events skip approval. */
    beforeChange: [eventDatesHook],
    afterChange: [
      /** FIRST, as on pages: the entry is in the change's transaction. */
      unlessFeedSync(auditChange('events')),
      /** Live in seconds on every site — a calendar block on any site may show it. */
      unlessFeedSync(revalidateEvent),
    ],
    afterDelete: [unlessFeedSync(auditDelete('events'))],
  },

  fields: [
    // Which site this is on, for the district (Jason, 2026-11-18) — see `siteNameField`.
    siteNameField(),
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: { description: 'The event’s name, as the calendar shows it.' },
    },
    {
      /**
       * One calendar, of the event's own site (Jason, 2026-10-28). Left empty, the site's own
       * calendar is used (`eventCalendarIsThisSites`), which also refuses another site's.
       */
      name: 'calendar',
      type: 'relationship',
      relationTo: 'calendars',
      label: 'Calendar',
      filterOptions: ({ data }) => {
        const tenant = (data as { tenant?: unknown } | undefined)?.tenant
        return tenant === undefined || tenant === null ? true : { tenant: { equals: tenant } }
      },
      admin: { description: 'Which calendar this goes on. Leave empty for the school’s own.' },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'start',
          type: 'date',
          required: true,
          index: true,
          label: 'Starts',
          admin: { date: { pickerAppearance: 'dayAndTime', displayFormat: 'MMM d, yyyy h:mm a' } },
        },
        {
          name: 'end',
          type: 'date',
          label: 'Ends',
          admin: {
            date: { pickerAppearance: 'dayAndTime', displayFormat: 'MMM d, yyyy h:mm a' },
            description: 'Optional.',
          },
        },
      ],
    },
    {
      name: 'allDay',
      type: 'checkbox',
      label: 'All day',
      defaultValue: false,
      admin: { description: 'The times are ignored; only the days are shown.' },
    },
    {
      name: 'location',
      type: 'text',
      label: 'Location',
      admin: { description: 'Optional. Where it is, e.g. "Auditorium".' },
    },
    {
      name: 'repeat',
      // A radio, not a select: Payload's select input fails axe (`docs/phases/04` §17).
      type: 'radio',
      label: 'Repeats',
      defaultValue: 'none',
      options: REPEAT_OPTIONS.map(({ value, label }) => ({ value, label })),
    },
    {
      name: 'repeatUntil',
      type: 'date',
      label: 'Repeats until',
      index: true,
      admin: {
        date: { pickerAppearance: 'dayOnly', displayFormat: 'MMM d, yyyy' },
        description: 'The last date it happens on.',
        condition: (_data, sibling: { repeat?: unknown } | undefined) =>
          sibling?.repeat !== undefined && sibling.repeat !== 'none',
      },
    },
    {
      /** The global constrained editor (`07` §4.4), as on pages — pasted agendas are normalized. */
      name: 'notes',
      type: 'richText',
      label: 'Notes',
      admin: { description: 'Optional. Shown when someone clicks the event on the calendar.' },
    },
    /**
     * Set only by the feed sync (`src/jobs/calendar-feeds.ts`), never through the API: which
     * occurrence of the outside calendar this is, and a hash of what it showed. An event with a
     * `feedUid` is read-only (`src/access/events.ts`).
     */
    {
      name: 'feedUid',
      type: 'text',
      index: true,
      access: { create: () => false, update: () => false },
      admin: { hidden: true },
    },
    {
      name: 'feedFingerprint',
      type: 'text',
      access: { create: () => false, update: () => false },
      admin: { hidden: true },
    },
  ],
}
