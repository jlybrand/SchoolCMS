import type { CollectionConfig } from 'payload'

import { schoolListReadAccess } from '@/access/post-structure'
import { isDistrictAdmin } from '@/access/predicates'
import { districtOnly } from '@/access/tenant-scoped'
import type { AuthUser } from '@/access/types'
import {
  dropFeedEvents,
  keepMainCalendar,
  labelCalendar,
  queueFeedSync,
} from '@/collections/hooks/event-hooks'
import { checkFeedUrl } from '@/lib/feed-sync'

/**
 * `calendars` — what events are organised into (Jason, 2026-10-28; Finalsite's Calendar Manager).
 *
 *   - Every calendar belongs to ONE site. Each site gets its own automatically, named after it
 *     (`makeMainCalendar`, on `tenants`), and keeps it (`keepMainCalendar`).
 *   - The DISTRICT makes the others, e.g. "District HS" or "Testing" on the district site.
 *   - An event is on exactly one calendar, of its own site.
 *   - A calendar BLOCK picks calendars from any site — reach is chosen there, by the district,
 *     as a news feed's boards are. Nothing here widens who sees an event.
 *
 * LOCAL OR A FEED (Jason, 2026-11-11). A local calendar's events are added here. A feed calendar's
 * come from an outside calendar's iCal address (a Google calendar's public address, an athletics
 * scheduler): `src/jobs/calendar-feeds.ts` fetches it hourly, keeps the last good copy when the
 * source fails, and its events are read-only here (`src/access/events.ts`). A new or changed
 * address is fetched within minutes (`queueFeedSync`). Turning a feed calendar back to local
 * removes the feed's events (`dropFeedEvents`).
 *
 * `label` is "Site · Calendar", for the district picking across 28 sites; kept by `labelCalendar`.
 */
export const Calendars: CollectionConfig = {
  slug: 'calendars',
  labels: { singular: 'Calendar', plural: 'Calendars' },
  graphQL: { singularName: 'Calendar', pluralName: 'Calendars' },
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label'],
    group: 'Content',
    hidden: ({ user }) => !isDistrictAdmin(user as AuthUser | null),
  },
  access: {
    read: schoolListReadAccess,
    create: districtOnly,
    update: districtOnly,
    delete: districtOnly,
  },
  hooks: {
    beforeChange: [labelCalendar],
    afterChange: [queueFeedSync, dropFeedEvents],
    beforeDelete: [keepMainCalendar],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'What the calendar is called, e.g. "Athletics" or "Testing".' },
    },
    /** The site's own calendar — made with the site, never deleted. Set by the platform only. */
    {
      name: 'isMain',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      access: { create: () => false, update: () => false },
      admin: { hidden: true },
    },
    { name: 'label', type: 'text', admin: { hidden: true } },
    {
      name: 'source',
      // A radio, not a select: Payload's select input fails axe (`docs/phases/04` §17).
      type: 'radio',
      label: 'Where its events come from',
      defaultValue: 'local',
      options: [
        { label: 'Added here', value: 'local' },
        { label: 'Another calendar’s address (iCal or Google)', value: 'feed' },
      ],
    },
    {
      name: 'feedUrl',
      type: 'text',
      label: 'Calendar address',
      validate: (value: unknown, { siblingData }: { siblingData?: { source?: unknown } }) => {
        if (siblingData?.source !== 'feed') return true
        const check = checkFeedUrl(value)
        return check.ok ? true : check.error
      },
      admin: {
        description:
          'The calendar’s public iCal address (in Google Calendar: Settings → the calendar → “Public address in iCal format”). Its events are copied here every hour and can’t be edited here.',
        condition: (_data, sibling: { source?: unknown } | undefined) => sibling?.source === 'feed',
      },
    },
    {
      name: 'feedSyncedAt',
      type: 'date',
      label: 'Last copied',
      access: { create: () => false, update: () => false },
      admin: {
        readOnly: true,
        date: { pickerAppearance: 'dayAndTime', displayFormat: 'MMM d, yyyy h:mm a' },
        condition: (_data, sibling: { source?: unknown } | undefined) => sibling?.source === 'feed',
      },
    },
    {
      name: 'feedError',
      type: 'textarea',
      label: 'Last problem',
      access: { create: () => false, update: () => false },
      admin: {
        readOnly: true,
        description: 'Empty when the last copy worked. The calendar keeps its last good copy.',
        condition: (_data, sibling: { source?: unknown } | undefined) => sibling?.source === 'feed',
      },
    },
  ],
}
