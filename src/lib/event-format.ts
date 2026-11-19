import type { CalendarEvent, EventOccurrence } from '@/content/types'

import { occurrences, type DateRange } from './recurrence'

/**
 * Events to what a calendar shows (Jason, 2026-11-11): every time each happens in a range,
 * earliest first, with the day and time already written in the reader's language and the
 * district's time zone. Pure — the content layer calls it; the calendar block only renders.
 *
 * Wording comes from `Intl`, so "6:00 – 8:00 PM" in English is "18:00–20:00" in Spanish without a
 * string table. "All day" is the one fixed phrase, translated with the rest of the chrome
 * (`08`).
 */

type Options = {
  locale: string
  timeZone: string
  /** The most to return — a list block's "number of events". */
  limit?: number
}

/** An all-day date `YYYY-MM-DD` as a Date that formats as that day in UTC. */
const dayAt = (date: string) => new Date(`${date}T12:00:00.000Z`)

const label = (
  o: { start: string; end: string | null; allDay: boolean; startDate: string; endDate: string },
  { locale, timeZone }: Options,
) => {
  const multiDay = o.endDate !== o.startDate
  // Several whole days say so in the date (`dateLabel`), so there is no time to add.
  if (o.allDay) return multiDay ? null : 'All day'
  const start = new Date(o.start)
  if (o.end === null) {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(
      start,
    )
  }
  const format = new Intl.DateTimeFormat(locale, {
    ...(multiDay ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  } as Intl.DateTimeFormatOptions)
  return format.formatRange(start, new Date(o.end))
}

/** Day, then all-day before timed, then time, then title — stable for equal events. */
const order = (a: EventOccurrence, b: EventOccurrence) =>
  a.startDate.localeCompare(b.startDate) ||
  Number(b.allDay) - Number(a.allDay) ||
  a.start.localeCompare(b.start) ||
  a.title.localeCompare(b.title) ||
  a.eventId.localeCompare(b.eventId)

export const toEventOccurrences = (
  events: readonly CalendarEvent[],
  range: DateRange,
  options: Options,
): EventOccurrence[] => {
  const dateFormat = new Intl.DateTimeFormat(options.locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const all = events.flatMap((event) =>
    occurrences(event.timing, range, options.timeZone).map((o): EventOccurrence => ({
      key: `${event.id}-${o.startDate}`,
      eventId: event.id,
      calendarId: event.calendarId,
      title: event.title,
      location: event.location,
      notes: event.notes,
      allDay: event.timing.allDay,
      ...o,
      dateLabel:
        event.timing.allDay && o.endDate !== o.startDate
          ? dateFormat.formatRange(dayAt(o.startDate), dayAt(o.endDate))
          : dateFormat.format(dayAt(o.startDate)),
      timeLabel: label({ ...o, allDay: event.timing.allDay }, options),
    })),
  )
  all.sort(order)
  return options.limit === undefined ? all : all.slice(0, Math.max(0, options.limit))
}
