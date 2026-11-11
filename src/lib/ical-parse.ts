import ICAL from 'ical.js'

import { addDays, zonedTime } from './recurrence'

/**
 * An outside calendar's iCal feed, read into dated events (Jason, 2026-11-11: feed calendars —
 * an iCal URL or a Google calendar's public address). Pure; the sync job fetches, this reads.
 *
 * EVERY REPEAT IS EXPANDED HERE. DD2's events hold Finalsite's seven repeat choices; a feed may
 * use any RRULE, with EXDATEs and moved or cancelled instances (RECURRENCE-ID). So each time an
 * event happens in the range becomes one dated event, its exceptions applied — the calendar
 * then shows exactly what the source shows. Mozilla's `ical.js` does the reading and expanding
 * (decided 2026-11-11): RFC 5545 is not worth a hand-written parser.
 *
 * THE UID IS STABLE PER OCCURRENCE: the event's UID and the instant (or date) it was ORIGINALLY
 * due — its RECURRENCE-ID — so a moved instance keeps its identity and the sync updates it rather
 * than deleting one event and creating another.
 *
 * Times: an event in a time zone the feed defines, or in UTC, is read as its instant. A time with
 * no zone ("floating") or a zone the feed does not define is read in the district's zone — the
 * only reading that makes sense for a school's calendar.
 */

export type FeedEvent = {
  /** `<UID>|<original start>` — stable across fetches. */
  uid: string
  title: string
  location: string | null
  description: string | null
  allDay: boolean
  /** ISO instant; for an all-day event, district-local midnight of its first day. */
  start: string
  /** ISO instant, or null; for an all-day event, midnight of its LAST day (null for one day). */
  end: string | null
}

export type ParseOptions = {
  range: { from: Date; to: Date }
  /** The district's zone, for all-day dates and floating times. */
  timeZone: string
  /** The most events one feed yields — a guard against a feed that repeats forever. */
  cap?: number
}

export const MAX_FEED_EVENTS = 2000

export class NotACalendarError extends Error {
  constructor() {
    super('The address did not return an iCal calendar.')
    this.name = 'NotACalendarError'
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

const dateOf = (time: ICAL.Time) => `${time.year}-${pad(time.month)}-${pad(time.day)}`

const text = (value: unknown): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed === '' ? null : trimmed
}

/** Known zones are read as their instant; floating or undefined ones in the district's zone. */
const instantOf = (time: ICAL.Time, timeZone: string, known: ReadonlySet<string>): string => {
  const tzid = time.zone?.tzid
  if (tzid === 'UTC' || (tzid !== undefined && known.has(tzid))) {
    return time.toJSDate().toISOString()
  }
  return zonedTime(dateOf(time), time.hour, time.minute, timeZone)
}

/** What identifies an occurrence: the date for all-day, else the original instant. */
const occurrenceKey = (time: ICAL.Time, timeZone: string, known: ReadonlySet<string>) =>
  time.isDate ? dateOf(time) : instantOf(time, timeZone, known)

const toFeedEvent = (
  item: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time | null,
  originalStart: ICAL.Time,
  { timeZone, known }: { timeZone: string; known: ReadonlySet<string> },
): FeedEvent => {
  const base = {
    uid: `${item.uid}|${occurrenceKey(originalStart, timeZone, known)}`,
    title: text(item.summary) ?? 'Event',
    location: text(item.location),
    description: text(item.description),
  }
  if (start.isDate) {
    const first = dateOf(start)
    // iCal's end date is the day AFTER the last; DD2 stores the last.
    const last = end && end.isDate ? addDays(dateOf(end), -1) : first
    return {
      ...base,
      allDay: true,
      start: zonedTime(first, 0, 0, timeZone),
      end: last > first ? zonedTime(last, 0, 0, timeZone) : null,
    }
  }
  const startIso = instantOf(start, timeZone, known)
  const endIso = end ? instantOf(end, timeZone, known) : null
  return {
    ...base,
    allDay: false,
    start: startIso,
    end: endIso !== null && endIso > startIso ? endIso : null,
  }
}

const cancelled = (component: ICAL.Component) =>
  String(component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED'

/**
 * Every event in `range`, earliest first. Throws `NotACalendarError` for something that is not an
 * iCal calendar (an HTML sign-in page, an empty body) — the sync keeps its last good copy rather
 * than emptying the calendar. A real calendar with no events is `[]`.
 */
export const parseFeed = (body: string, options: ParseOptions): FeedEvent[] => {
  if (!/^\s*BEGIN:VCALENDAR/i.test(body)) throw new NotACalendarError()
  let root: ICAL.Component
  try {
    root = new ICAL.Component(ICAL.parse(body) as never)
  } catch {
    throw new NotACalendarError()
  }

  const known = new Set<string>()
  for (const vtimezone of root.getAllSubcomponents('vtimezone')) {
    const tzid = String(vtimezone.getFirstPropertyValue('tzid') ?? '')
    if (tzid === '') continue
    ICAL.TimezoneService.register(vtimezone)
    known.add(tzid)
  }

  const vevents = root.getAllSubcomponents('vevent')
  const exceptions = vevents.filter((v) => v.hasProperty('recurrence-id'))
  const masters = vevents.filter((v) => !v.hasProperty('recurrence-id'))

  const cap = options.cap ?? MAX_FEED_EVENTS
  const from = ICAL.Time.fromJSDate(options.range.from, true)
  const to = ICAL.Time.fromJSDate(options.range.to, true)
  const context = { timeZone: options.timeZone, known }
  const out: FeedEvent[] = []

  for (const component of masters) {
    if (cancelled(component)) continue
    const event = new ICAL.Event(component)
    for (const exception of exceptions) {
      if (exception.getFirstPropertyValue('uid') === event.uid) event.relateException(exception)
    }

    if (!event.isRecurring()) {
      if (event.startDate.compare(to) > 0) continue
      const end = event.endDate ?? event.startDate
      if (end.compare(from) < 0) continue
      out.push(toFeedEvent(event, event.startDate, event.endDate ?? null, event.startDate, context))
      continue
    }

    const iterator = event.iterator()
    for (let next = iterator.next(); next; next = iterator.next()) {
      if (next.compare(to) > 0 || out.length >= cap * 4) break
      const details = event.getOccurrenceDetails(next)
      if (details.endDate.compare(from) < 0) continue
      const item = details.item as ICAL.Event
      if (item.component && cancelled(item.component)) continue
      out.push(toFeedEvent(item, details.startDate, details.endDate, details.recurrenceId, context))
    }
  }

  out.sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid))
  return out.slice(0, cap)
}
