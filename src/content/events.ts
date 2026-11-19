import { getPayload, type Where } from 'payload'

import config from '@payload-config'

import { tenantIdOf } from '@/access/predicates'

import { toEventOccurrences } from '@/lib/event-format'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'
import { addDays, zonedTime, type DateRange } from '@/lib/recurrence'

import { toCalendarEvent } from './event-mapper'
import type { CalendarEvent, ContentContext, EventOccurrence, Tenant } from './types'

/**
 * Calendar events for a calendar block (`02` §11; Jason, 2026-10-28 and 2026-11-11).
 *
 * ============================================================================
 * THIS FILE IS ON THE PAYLOAD SIDE OF THE BOUNDARY.
 * It may import the SDK. It returns DD2 domain types and nothing else.
 * ============================================================================
 *
 * REACH IS THE BLOCK'S CALENDARS. A calendar block may show any site's calendars — the district
 * places it and chooses them, as it chooses a news feed's boards — so the query is by calendar,
 * not by the rendering site. What keeps it safe is the other half, stated here because access is
 * overridden on this path: PUBLISHED only. An event has no staff-only setting, so a published
 * event is public through the API already; this read shows nothing the API would not.
 *
 * Runs at build or revalidate time, never per visitor (`02` §5). Pages revalidate hourly, so an
 * "upcoming" list moves on as days pass without a publish.
 */

/** The most events one read considers, before repeats are expanded. */
const MAX_EVENTS = 1000

export type EventQuery = {
  calendars: readonly string[]
  range: DateRange
  /** The most occurrences to return — a list block's "number of events". */
  limit?: number
}

/**
 * Stored events that might happen in `range`: started by its end, and not over before its
 * start. A day of slack each side — the exact cut is `occurrences`', in the district's zone.
 */
const overlapping = ({ from, to }: DateRange): Where => {
  const after = zonedTime(addDays(from, -1), 0, 0, DISTRICT_TIME_ZONE)
  const before = zonedTime(addDays(to, 2), 0, 0, DISTRICT_TIME_ZONE)
  return {
    and: [
      { start: { less_than: before } },
      {
        or: [
          { start: { greater_than_equal: after } },
          { end: { greater_than_equal: after } },
          { repeatUntil: { greater_than_equal: after } },
        ],
      },
    ],
  }
}

export const listEvents = async ({ calendars, range }: EventQuery): Promise<CalendarEvent[]> => {
  if (calendars.length === 0) return []
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'events',
    where: {
      and: [
        { calendar: { in: [...calendars] } },
        { _status: { equals: 'published' } },
        overlapping(range),
      ],
    },
    sort: ['start', 'id'],
    limit: MAX_EVENTS,
    depth: 0,
    overrideAccess: true,
  })
  return docs.map(toCalendarEvent).filter((event): event is CalendarEvent => event !== null)
}

/** Every time the block's calendars' events happen in `range`, ready to render. */
export const listEventOccurrences = async (
  ctx: ContentContext,
  query: EventQuery,
): Promise<EventOccurrence[]> =>
  toEventOccurrences(await listEvents(query), query.range, {
    locale: ctx.locale,
    timeZone: DISTRICT_TIME_ZONE,
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  })

/** A calendar as the public site names it: its name and its home site. */
export type CalendarRef = { id: string; name: string; hostname: string }

/** The named calendars, with their home sites' hostnames; unknown ids are left out. */
export const listCalendarRefs = async (ids: readonly string[]): Promise<CalendarRef[]> => {
  if (ids.length === 0) return []
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'calendars',
    where: { id: { in: [...ids] } },
    pagination: false,
    depth: 1,
    overrideAccess: true,
    select: { name: true, tenant: true },
  })
  const byId = new Map(
    docs.flatMap((doc) => {
      const tenant = (doc as { tenant?: unknown }).tenant
      const hostname =
        typeof tenant === 'object' && tenant !== null
          ? (tenant as { hostname?: unknown }).hostname
          : null
      const name = typeof doc.name === 'string' ? doc.name.trim() : ''
      return typeof hostname === 'string' && hostname !== '' && name !== ''
        ? [[String(doc.id), { id: String(doc.id), name, hostname }] as const]
        : []
    }),
  )
  // In the block's order, so the links read as the district chose the calendars.
  return ids.flatMap((id) => {
    const ref = byId.get(id)
    return ref ? [ref] : []
  })
}

/** How far back and ahead a feed reaches: a year of history, ten years of repeats ahead. */
const FEED_DAYS_BACK = 365
const FEED_DAYS_AHEAD = 3650

/**
 * A calendar's published events for its iCal feed — only on ITS OWN SITE (one address per
 * calendar, as one per announcement): another site's calendar id on this host is null, and 404s.
 * `today` is the district's date.
 */
export const getCalendarFeed = async (
  tenant: Tenant,
  calendarId: string,
  today: string,
): Promise<{ name: string; events: CalendarEvent[] } | null> => {
  const payload = await getPayload({ config })
  const calendar = await payload.findByID({
    collection: 'calendars',
    id: calendarId,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })
  if (!calendar || tenantIdOf((calendar as { tenant?: unknown }).tenant as never) !== tenant.id) {
    return null
  }
  const events = await listEvents({
    calendars: [calendarId],
    range: { from: addDays(today, -FEED_DAYS_BACK), to: addDays(today, FEED_DAYS_AHEAD) },
  })
  return { name: String((calendar as { name?: unknown }).name ?? tenant.name), events }
}

/**
 * Several calendars' ONE feed (Jason, 2026-11-19: one Subscribe link per calendar block, following
 * its filter) — `/calendars/3-7-12.ics` on the site whose page offers it. Any site's calendars, as
 * the block that offers it shows them: a published event is public already, and this only lists
 * them together. Null when any id is not a calendar, so a stale or crafted address 404s whole.
 * The address's form (ascending, distinct, at most twenty) is checked by the route (`feedIds`).
 */
export const getCombinedCalendarFeed = async (
  calendarIds: readonly string[],
  today: string,
): Promise<{ name: string; events: CalendarEvent[] } | null> => {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'calendars',
    where: { id: { in: [...calendarIds] } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    select: { name: true },
  })
  if (docs.length !== new Set(calendarIds).size) return null
  const names = new Map(docs.map((doc) => [String(doc.id), String(doc.name ?? '').trim()]))
  const events = await listEvents({
    calendars: calendarIds,
    range: { from: addDays(today, -FEED_DAYS_BACK), to: addDays(today, FEED_DAYS_AHEAD) },
  })
  return {
    name: calendarIds
      .map((id) => names.get(id))
      .filter(Boolean)
      .join(', '),
    events,
  }
}
