import { describe, expect, it } from 'vitest'

import type { CalendarEvent } from '@/content/types'
import { toEventOccurrences } from '@/lib/event-format'

/**
 * Events to what a calendar shows: every time each one happens in a range, in order, with its
 * date and time already written out in the reader's language and the district's time zone.
 * The component only renders (`02` §11).
 *
 * Intl spaces times with narrow no-break and thin spaces; `plain` folds them so the
 * expectations read as a person would type them.
 */

const NY = 'America/New_York'
const plain = (s: string | null | undefined) => s?.replace(/[   ]/g, ' ') ?? s

const event = (
  overrides: Partial<Omit<CalendarEvent, 'timing'>> & { timing?: Partial<CalendarEvent['timing']> },
) => {
  const { timing, ...rest } = overrides
  return {
    id: '1',
    tenantId: '3',
    calendarId: '9',
    title: 'Winter concert',
    location: 'Auditorium',
    notes: [],
    ...rest,
    timing: {
      start: '2026-12-04T23:00:00.000Z',
      end: '2026-12-05T01:00:00.000Z',
      allDay: false,
      repeat: 'none' as const,
      repeatUntil: null,
      ...timing,
    },
  }
}

const december = { from: '2026-12-01', to: '2026-12-31' }
const opts = { locale: 'en', timeZone: NY }

describe('toEventOccurrences', () => {
  it('writes out a timed event’s day and times', () => {
    const [only] = toEventOccurrences([event({})], december, opts)
    expect(only).toMatchObject({
      key: '1-2026-12-04',
      eventId: '1',
      title: 'Winter concert',
      location: 'Auditorium',
      allDay: false,
      start: '2026-12-04T23:00:00.000Z',
      end: '2026-12-05T01:00:00.000Z',
      startDate: '2026-12-04',
      endDate: '2026-12-04',
      dateLabel: 'Friday, December 4, 2026',
    })
    expect(plain(only!.timeLabel)).toBe('6:00 – 8:00 PM')
  })

  it('a start with no end is the start time alone', () => {
    const [only] = toEventOccurrences([event({ timing: { end: null } })], december, opts)
    expect(plain(only!.timeLabel)).toBe('6:00 PM')
  })

  it('all day says so', () => {
    const [only] = toEventOccurrences(
      [event({ timing: { allDay: true, start: '2026-12-04T05:00:00.000Z', end: null } })],
      december,
      opts,
    )
    expect(only).toMatchObject({ allDay: true, start: '2026-12-04', timeLabel: 'All day' })
  })

  it('several days, all day: the run of dates', () => {
    const [only] = toEventOccurrences(
      [
        event({
          title: 'Winter break',
          timing: {
            allDay: true,
            start: '2026-12-21T05:00:00.000Z',
            end: '2026-12-25T05:00:00.000Z',
          },
        }),
      ],
      december,
      opts,
    )
    expect(plain(only!.timeLabel)).toBe('Dec 21 – 25')
  })

  it('several days, timed: both days and times', () => {
    const [only] = toEventOccurrences(
      [event({ timing: { start: '2026-12-01T14:00:00.000Z', end: '2026-12-03T20:00:00.000Z' } })],
      december,
      opts,
    )
    expect(plain(only!.timeLabel)).toBe('Dec 1, 9:00 AM – Dec 3, 3:00 PM')
  })

  it('writes the labels in the reader’s language', () => {
    const [only] = toEventOccurrences([event({})], december, { locale: 'es', timeZone: NY })
    expect(only!.dateLabel).toBe('viernes, 4 de diciembre de 2026')
  })

  it('expands repeats, and keys each time apart', () => {
    const weekly = event({
      timing: {
        start: '2026-12-01T21:00:00.000Z',
        end: null,
        repeat: 'weekly',
        repeatUntil: '2026-12-15',
      },
    })
    expect(toEventOccurrences([weekly], december, opts).map((o) => o.key)).toEqual([
      '1-2026-12-01',
      '1-2026-12-08',
      '1-2026-12-15',
    ])
  })

  it('orders by day, all-day first within a day, then by time, then by title', () => {
    const got = toEventOccurrences(
      [
        event({
          id: 'late',
          title: 'B late',
          timing: { start: '2026-12-04T23:00:00.000Z', end: null },
        }),
        event({
          id: 'next',
          title: 'Next day',
          timing: { start: '2026-12-05T14:00:00.000Z', end: null },
        }),
        event({
          id: 'early',
          title: 'Early',
          timing: { start: '2026-12-04T13:00:00.000Z', end: null },
        }),
        event({
          id: 'a-late',
          title: 'A late',
          timing: { start: '2026-12-04T23:00:00.000Z', end: null },
        }),
        event({
          id: 'all',
          title: 'Spirit day',
          timing: { allDay: true, start: '2026-12-04T05:00:00.000Z', end: null },
        }),
      ],
      december,
      opts,
    )
    expect(got.map((o) => o.eventId)).toEqual(['all', 'early', 'a-late', 'late', 'next'])
  })

  it('a limit keeps the earliest — the list block’s "number of events"', () => {
    const daily = event({
      timing: {
        start: '2026-12-01T13:00:00.000Z',
        end: null,
        repeat: 'daily',
        repeatUntil: '2026-12-31',
      },
    })
    const got = toEventOccurrences([daily], december, { ...opts, limit: 3 })
    expect(got.map((o) => o.startDate)).toEqual(['2026-12-01', '2026-12-02', '2026-12-03'])
  })

  it('carries the notes through for the click', () => {
    const notes = [
      {
        kind: 'paragraph' as const,
        children: [{ kind: 'text' as const, text: 'Bring a coat.', marks: [] }],
      },
    ]
    expect(toEventOccurrences([event({ notes })], december, opts)[0]!.notes).toEqual(notes)
  })

  it('nothing in range is an empty list', () => {
    expect(toEventOccurrences([event({})], { from: '2027-01-01', to: '2027-01-31' }, opts)).toEqual(
      [],
    )
  })
})
