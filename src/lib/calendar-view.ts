import type { CalendarMonth, EventOccurrence } from '@/content/types'

import { monthGrid, monthRange, spreadByDay } from './month-grid'

/**
 * The calendar block's grid (Jason, 2026-11-11), built once in the resolve pass so the block only
 * renders. Pure.
 *
 * A day holds the KEYS of what happens on it; the occurrences are listed once on the block, so an
 * event's notes are sent once however many days it covers.
 */

/** Sunday first; short and long names in the reader's language. 4 January 2026 was a Sunday. */
export const weekdayNames = (locale: string): { short: string; long: string }[] => {
  const short = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const long = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 4 + i, 12))
    return { short: short.format(day).replace(/\.$/, ''), long: long.format(day) }
  })
}

type Options = { months: readonly string[]; today: string; locale: string }

export const toGridMonths = (
  occurrences: readonly EventOccurrence[],
  { months, today, locale }: Options,
): CalendarMonth[] => {
  const byDay = spreadByDay(occurrences)
  const label = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return months.map((key) => {
    const { from, to } = monthRange(key)
    return {
      key,
      label: label.format(new Date(`${from}T12:00:00.000Z`)),
      weeks: monthGrid(key).map((week) =>
        week.map((date) =>
          date === null
            ? null
            : {
                date,
                day: Number(date.slice(8)),
                isToday: date === today,
                eventKeys: (byDay.get(date) ?? []).map((o) => o.key),
              },
        ),
      ),
      eventKeys: occurrences
        .filter((o) => o.startDate <= to && o.endDate >= from)
        .map((o) => o.key),
    }
  })
}
