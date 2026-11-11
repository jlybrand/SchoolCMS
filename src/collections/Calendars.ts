import type { CollectionConfig } from 'payload'

import { schoolListReadAccess } from '@/access/post-structure'
import { isDistrictAdmin } from '@/access/predicates'
import { districtOnly } from '@/access/tenant-scoped'
import type { AuthUser } from '@/access/types'
import { keepMainCalendar, labelCalendar } from '@/collections/hooks/event-hooks'

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
 * Local calendars only for now. Feed calendars (an iCal or Google URL, fetched on a schedule)
 * are a later PR of this slice; `03` §3.4's "Calendar Tools — not a DD2 need" is corrected then.
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
  hooks: { beforeChange: [labelCalendar], beforeDelete: [keepMainCalendar] },
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
  ],
}
