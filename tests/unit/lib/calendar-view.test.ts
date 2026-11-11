import { describe, expect, it } from 'vitest'

import type { EventOccurrence } from '@/content/types'
import { toGridMonths, weekdayNames } from '@/lib/calendar-view'

/**
 * The calendar block's grid (Jason, 2026-11-11), built from occurrences: months of weeks of days,
 * each day holding the KEYS of what happens on it — the occurrences themselves are listed once on
 * the block, so an event's notes are sent once however many days it covers.
 */

const occ = (key: string, startDate: string, endDate = startDate): EventOccurrence => ({
  key,
  eventId: key,
  title: key,
  location: null,
  notes: [],
  allDay: false,
  start: `${startDate}T23:00:00.000Z`,
  end: null,
  startDate,
  endDate,
  dateLabel: startDate,
  timeLabel: null,
})

describe('weekdayNames', () => {
  it('Sunday first, short and long, in the reader’s language', () => {
    expect(weekdayNames('en')[0]).toEqual({ short: 'Sun', long: 'Sunday' })
    expect(weekdayNames('en')[6]).toEqual({ short: 'Sat', long: 'Saturday' })
    expect(weekdayNames('es')[1]).toEqual({ short: 'lun', long: 'lunes' })
  })
})

describe('toGridMonths', () => {
  const months = toGridMonths(
    [occ('concert', '2026-11-20'), occ('break', '2026-11-30', '2026-12-02')],
    { months: ['2026-11', '2026-12'], today: '2026-11-11', locale: 'en' },
  )

  it('one month per month asked for, labelled in the reader’s language', () => {
    expect(months.map((m) => [m.key, m.label])).toEqual([
      ['2026-11', 'November 2026'],
      ['2026-12', 'December 2026'],
    ])
  })

  it('each day carries its number, whether it is today, and what happens on it', () => {
    const days = months[0]!.weeks.flat().filter((d) => d !== null)
    expect(days.find((d) => d.date === '2026-11-11')).toEqual({
      date: '2026-11-11',
      day: 11,
      isToday: true,
      eventKeys: [],
    })
    expect(days.find((d) => d.date === '2026-11-20')).toMatchObject({
      isToday: false,
      eventKeys: ['concert'],
    })
  })

  it('an event running into the next month is on its days in both', () => {
    const day = (m: number, date: string) =>
      months[m]!.weeks.flat().find((d) => d?.date === date)?.eventKeys
    expect(day(0, '2026-11-30')).toEqual(['break'])
    expect(day(1, '2026-12-01')).toEqual(['break'])
    expect(day(1, '2026-12-02')).toEqual(['break'])
    expect(day(1, '2026-12-03')).toEqual([])
  })

  it('days outside the month are null', () => {
    expect(months[1]!.weeks[0]!.slice(0, 2)).toEqual([null, null])
  })

  it('says how many events each month holds, for the narrow-screen list', () => {
    expect(months.map((m) => m.eventKeys)).toEqual([['concert', 'break'], ['break']])
  })
})
