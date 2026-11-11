import { describe, expect, it } from 'vitest'

import {
  addDays,
  localDateOf,
  occurrences,
  REPEAT_OPTIONS,
  toRRule,
  zonedTime,
  type EventTiming,
} from '@/lib/recurrence'

/**
 * Event dates and Finalsite's Repeat choices (Jason, 2026-11-11: "the same fields as Finalsite
 * calendar events"). Calendar Manager offers daily, week days, MWF, TTh, weekly, monthly and
 * yearly; DD2 asks for a last date so nothing repeats forever.
 *
 * Every rule is in the district's time zone: a 4 p.m. weekly meeting stays at 4 p.m. across
 * the change to and from daylight saving, which a UTC step of 7 × 24 hours would not.
 */

const NY = 'America/New_York'

const timed = (
  start: string,
  end: string | null,
  extra: Partial<EventTiming> = {},
): EventTiming => ({
  start,
  end,
  allDay: false,
  repeat: 'none',
  repeatUntil: null,
  ...extra,
})

const range = (from: string, to: string) => ({ from, to })

describe('local dates in the district time zone', () => {
  it('reads the local calendar date of an instant', () => {
    // 02:30 UTC on the 5th is 21:30 on the 4th in New York (EST, UTC-5).
    expect(localDateOf('2026-12-05T02:30:00.000Z', NY)).toBe('2026-12-04')
  })

  it('turns a local wall-clock time into the right instant either side of daylight saving', () => {
    expect(zonedTime('2026-01-15', 16, 0, NY)).toBe('2026-01-15T21:00:00.000Z') // EST
    expect(zonedTime('2026-07-15', 16, 0, NY)).toBe('2026-07-15T20:00:00.000Z') // EDT
  })

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('the Repeat choices', () => {
  it('offers Finalsite’s list, with "Does not repeat" first', () => {
    expect(REPEAT_OPTIONS.map((o) => o.value)).toEqual([
      'none',
      'daily',
      'weekdays',
      'mwf',
      'tth',
      'weekly',
      'monthly',
      'yearly',
    ])
    expect(REPEAT_OPTIONS[0]!.label).toBe('Does not repeat')
  })

  it('has no ":" in any value — GraphQL refuses one (the posts lesson)', () => {
    for (const { value } of REPEAT_OPTIONS) expect(value).not.toContain(':')
  })
})

describe('toRRule — how a repeat reads in iCal (RFC 5545)', () => {
  it.each([
    ['none', null],
    ['daily', 'FREQ=DAILY;UNTIL=20270601T035959Z'],
    ['weekdays', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20270601T035959Z'],
    ['mwf', 'FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20270601T035959Z'],
    ['tth', 'FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20270601T035959Z'],
    ['weekly', 'FREQ=WEEKLY;UNTIL=20270601T035959Z'],
    ['monthly', 'FREQ=MONTHLY;UNTIL=20270601T035959Z'],
    ['yearly', 'FREQ=YEARLY;UNTIL=20270601T035959Z'],
  ] as const)('%s → %s', (repeat, rule) => {
    // UNTIL is the END of the last local day (23:59:59 EDT on 31 May = 03:59:59Z on 1 June).
    expect(toRRule(repeat, '2027-05-31', NY)).toBe(rule)
  })

  it('has no rule without a last date', () => {
    expect(toRRule('weekly', null, NY)).toBeNull()
  })
})

describe('occurrences — a one-off event', () => {
  const concert = timed('2026-12-04T23:00:00.000Z', '2026-12-05T01:00:00.000Z') // 6–8 p.m. EST

  it('is listed in a range that holds its local date', () => {
    expect(occurrences(concert, range('2026-12-01', '2026-12-31'), NY)).toEqual([
      {
        start: '2026-12-04T23:00:00.000Z',
        end: '2026-12-05T01:00:00.000Z',
        startDate: '2026-12-04',
        endDate: '2026-12-04',
      },
    ])
  })

  it('is not listed outside it', () => {
    expect(occurrences(concert, range('2026-12-05', '2026-12-31'), NY)).toEqual([])
    expect(occurrences(concert, range('2026-11-01', '2026-12-03'), NY)).toEqual([])
  })

  it('takes its range as inclusive at both ends', () => {
    expect(occurrences(concert, range('2026-12-04', '2026-12-04'), NY)).toHaveLength(1)
  })

  it('has no end when none was given — Finalsite lets the end time be blank', () => {
    const [only] = occurrences(
      timed('2026-12-04T23:00:00.000Z', null),
      range('2026-12-01', '2026-12-31'),
      NY,
    )
    expect(only).toEqual({
      start: '2026-12-04T23:00:00.000Z',
      end: null,
      startDate: '2026-12-04',
      endDate: '2026-12-04',
    })
  })

  it('a multi-day event is listed in any range it overlaps', () => {
    const camp = timed('2026-12-01T14:00:00.000Z', '2026-12-03T20:00:00.000Z')
    expect(occurrences(camp, range('2026-12-02', '2026-12-02'), NY)).toEqual([
      {
        start: '2026-12-01T14:00:00.000Z',
        end: '2026-12-03T20:00:00.000Z',
        startDate: '2026-12-01',
        endDate: '2026-12-03',
      },
    ])
  })

  it('an end before the start is read as no end, never as a negative event', () => {
    const [only] = occurrences(
      timed('2026-12-04T23:00:00.000Z', '2026-12-04T20:00:00.000Z'),
      range('2026-12-01', '2026-12-31'),
      NY,
    )
    expect(only!.end).toBeNull()
  })
})

describe('occurrences — all day', () => {
  it('is a run of local dates; start and end are the dates, not times', () => {
    // Picked in a New York browser: midnight local = 05:00Z.
    const breakWeek = {
      ...timed('2026-12-21T05:00:00.000Z', '2026-12-25T05:00:00.000Z'),
      allDay: true,
    }
    expect(occurrences(breakWeek, range('2026-12-01', '2026-12-31'), NY)).toEqual([
      { start: '2026-12-21', end: '2026-12-25', startDate: '2026-12-21', endDate: '2026-12-25' },
    ])
  })

  it('with no end is the one day', () => {
    const day = { ...timed('2026-12-21T05:00:00.000Z', null), allDay: true }
    expect(occurrences(day, range('2026-12-01', '2026-12-31'), NY)).toEqual([
      { start: '2026-12-21', end: null, startDate: '2026-12-21', endDate: '2026-12-21' },
    ])
  })
})

describe('occurrences — repeating', () => {
  // Tuesdays, 4–5 p.m. local, from 3 Nov 2026 (EST).
  const tuesdays = timed('2026-11-03T21:00:00.000Z', '2026-11-03T22:00:00.000Z', {
    repeat: 'weekly',
    repeatUntil: '2026-12-01',
  })

  it('weekly: the same weekday, the same local time, up to and including the last date', () => {
    const got = occurrences(tuesdays, range('2026-11-01', '2026-12-31'), NY)
    expect(got.map((o) => o.startDate)).toEqual([
      '2026-11-03',
      '2026-11-10',
      '2026-11-17',
      '2026-11-24',
      '2026-12-01',
    ])
    expect(got[1]).toEqual({
      start: '2026-11-10T21:00:00.000Z',
      end: '2026-11-10T22:00:00.000Z',
      startDate: '2026-11-10',
      endDate: '2026-11-10',
    })
  })

  it('keeps the local time across the change from daylight saving', () => {
    // Weekly from Tue 27 Oct 2026 (EDT, 20:00Z) — 3 Nov is EST, so 21:00Z.
    const fall = timed('2026-10-27T20:00:00.000Z', null, {
      repeat: 'weekly',
      repeatUntil: '2026-11-03',
    })
    expect(occurrences(fall, range('2026-10-01', '2026-11-30'), NY).map((o) => o.start)).toEqual([
      '2026-10-27T20:00:00.000Z',
      '2026-11-03T21:00:00.000Z',
    ])
  })

  it('only the occurrences inside the range are returned', () => {
    expect(
      occurrences(tuesdays, range('2026-11-15', '2026-11-25'), NY).map((o) => o.startDate),
    ).toEqual(['2026-11-17', '2026-11-24'])
  })

  it('daily', () => {
    const daily = timed('2026-11-03T13:00:00.000Z', null, {
      repeat: 'daily',
      repeatUntil: '2026-11-06',
    })
    expect(
      occurrences(daily, range('2026-11-01', '2026-11-30'), NY).map((o) => o.startDate),
    ).toEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'])
  })

  it('weekdays skips Saturday and Sunday', () => {
    // Thu 5 Nov 2026 to Tue 10 Nov.
    const w = timed('2026-11-05T13:00:00.000Z', null, {
      repeat: 'weekdays',
      repeatUntil: '2026-11-10',
    })
    expect(occurrences(w, range('2026-11-01', '2026-11-30'), NY).map((o) => o.startDate)).toEqual([
      '2026-11-05',
      '2026-11-06',
      '2026-11-09',
      '2026-11-10',
    ])
  })

  it('MWF and TTh', () => {
    const start = '2026-11-02T13:00:00.000Z' // a Monday
    const mwf = timed(start, null, { repeat: 'mwf', repeatUntil: '2026-11-08' })
    const tth = timed(start, null, { repeat: 'tth', repeatUntil: '2026-11-08' })
    const r = range('2026-11-01', '2026-11-30')
    expect(occurrences(mwf, r, NY).map((o) => o.startDate)).toEqual([
      '2026-11-02',
      '2026-11-04',
      '2026-11-06',
    ])
    // Starting on a Monday, a TTh event's first day is the Tuesday after.
    expect(occurrences(tth, r, NY).map((o) => o.startDate)).toEqual(['2026-11-03', '2026-11-05'])
  })

  it('monthly is the same date each month, and skips a month without it', () => {
    const m = timed('2027-01-31T15:00:00.000Z', null, {
      repeat: 'monthly',
      repeatUntil: '2027-05-31',
    })
    expect(occurrences(m, range('2027-01-01', '2027-12-31'), NY).map((o) => o.startDate)).toEqual([
      '2027-01-31',
      '2027-03-31',
      '2027-05-31',
    ])
  })

  it('yearly is the same date each year', () => {
    const y = timed('2026-12-04T15:00:00.000Z', null, {
      repeat: 'yearly',
      repeatUntil: '2028-12-31',
    })
    expect(occurrences(y, range('2026-01-01', '2030-12-31'), NY).map((o) => o.startDate)).toEqual([
      '2026-12-04',
      '2027-12-04',
      '2028-12-04',
    ])
  })

  it('a multi-day repeat keeps its length', () => {
    const w = timed('2026-11-06T22:00:00.000Z', '2026-11-08T17:00:00.000Z', {
      repeat: 'weekly',
      repeatUntil: '2026-11-13',
    })
    expect(occurrences(w, range('2026-11-01', '2026-11-30'), NY)[1]).toEqual({
      start: '2026-11-13T22:00:00.000Z',
      end: '2026-11-15T17:00:00.000Z',
      startDate: '2026-11-13',
      endDate: '2026-11-15',
    })
  })

  it('an all-day repeat repeats the dates', () => {
    const w = {
      ...timed('2026-11-02T05:00:00.000Z', null, { repeat: 'weekly', repeatUntil: '2026-11-09' }),
      allDay: true,
    }
    expect(occurrences(w, range('2026-11-01', '2026-11-30'), NY)).toEqual([
      { start: '2026-11-02', end: null, startDate: '2026-11-02', endDate: '2026-11-02' },
      { start: '2026-11-09', end: null, startDate: '2026-11-09', endDate: '2026-11-09' },
    ])
  })

  it('a repeat without a last date happens once, never forever', () => {
    const w = timed('2026-11-03T21:00:00.000Z', null, { repeat: 'weekly', repeatUntil: null })
    expect(occurrences(w, range('2026-11-01', '2027-12-31'), NY)).toHaveLength(1)
  })

  it('stops at the cap however long the range', () => {
    const w = timed('2026-11-03T13:00:00.000Z', null, {
      repeat: 'daily',
      repeatUntil: '2036-11-03',
    })
    expect(occurrences(w, range('2026-11-01', '2036-12-31'), NY, 50)).toHaveLength(50)
  })

  it('a start that is not a date yields nothing', () => {
    expect(occurrences(timed('not a date', null), range('2026-01-01', '2026-12-31'), NY)).toEqual(
      [],
    )
  })
})
