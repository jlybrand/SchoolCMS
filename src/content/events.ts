import { getPayload, type Where } from 'payload'

import config from '@payload-config'

import { toEventOccurrences } from '@/lib/event-format'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'
import { addDays, zonedTime, type DateRange } from '@/lib/recurrence'

import { toCalendarEvent } from './event-mapper'
import type { CalendarEvent, ContentContext, EventOccurrence } from './types'

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
