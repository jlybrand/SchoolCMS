import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseFeed } from '@/lib/ical-parse'

/**
 * Reading an outside calendar's iCal feed into dated events (Jason, 2026-11-11: feed calendars).
 * Tested against a REAL Google feed and a Google-format one with the hard cases — see
 * `tests/fixtures/ical/README.md`.
 *
 * Every repeat is expanded here, with its exceptions, into one dated event per time it happens:
 * DD2's events hold Finalsite's seven repeat choices, and an outside feed may use any rule.
 */

const fixture = (name: string) => readFileSync(join(__dirname, '../../fixtures/ical', name), 'utf8')

const NY = 'America/New_York'
const YEAR = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2027-12-31T00:00:00Z') }

describe('parseFeed — a real Google holiday feed', () => {
  const events = parseFeed(fixture('google-us-holidays.ics'), { range: YEAR, timeZone: NY })

  it('reads every event', () => {
    expect(events).toHaveLength(8)
  })

  it('an all-day event is a district-local day, with no end when it is one day', () => {
    expect(events[0]).toEqual({
      uid: '20260101_d3glsfo8cfrs476elqd81so37s@google.com|2026-01-01',
      title: "New Year's Day",
      location: null,
      description: 'Public holiday',
      allDay: true,
      start: '2026-01-01T05:00:00.000Z',
      end: null,
    })
  })

  it('unescapes Google’s text (\\n, \\,) and unfolds its lines', () => {
    const dst = events.find((e) => e.title === 'Daylight Saving Time starts')
    expect(dst?.description).toBe(
      'Observance\nTo hide observances, go to Google Calendar Settings > Holidays in United States',
    )
  })
})

describe('parseFeed — repeats, exceptions, time zones (Google format)', () => {
  const events = parseFeed(fixture('google-recurring.ics'), { range: YEAR, timeZone: NY })
  const practice = events.filter((e) => e.uid.startsWith('practice-weekly@google.com'))

  it('expands a weekly repeat, skipping its EXDATE, up to its UNTIL', () => {
    expect(practice.map((e) => e.uid.split('|')[1])).toEqual([
      '2026-10-27T20:00:00.000Z',
      '2026-11-03T21:00:00.000Z',
      '2026-11-17T21:00:00.000Z',
      '2026-11-24T21:00:00.000Z',
    ])
  })

  it('keeps local 4 p.m. across the change from daylight saving', () => {
    expect(practice[0]).toMatchObject({
      start: '2026-10-27T20:00:00.000Z',
      end: '2026-10-27T21:30:00.000Z',
    })
    expect(practice[1]).toMatchObject({
      start: '2026-11-03T21:00:00.000Z',
      end: '2026-11-03T22:30:00.000Z',
    })
  })

  it('a moved instance (RECURRENCE-ID) takes its new time, title and place, keeping its id', () => {
    expect(practice[2]).toEqual({
      uid: 'practice-weekly@google.com|2026-11-17T21:00:00.000Z',
      title: 'Soccer practice (moved indoors)',
      location: 'Main gym',
      description: null,
      allDay: false,
      start: '2026-11-18T22:00:00.000Z',
      end: '2026-11-18T23:30:00.000Z',
    })
  })

  it('the repeat’s own text carries to every instance', () => {
    expect(practice[0]).toMatchObject({
      title: 'Soccer practice',
      location: 'Practice field',
      description: 'Bring water, cleats and a signed form.\nPickup at 5:45.',
    })
  })

  it('a UTC event is read as its instant', () => {
    expect(events.find((e) => e.title === 'Basketball vs. Ashley Ridge')).toMatchObject({
      start: '2026-12-04T23:30:00.000Z',
      end: '2026-12-05T01:30:00.000Z',
      allDay: false,
    })
  })

  it('a cancelled event is left out', () => {
    expect(events.find((e) => e.title.includes('Fort Dorchester'))).toBeUndefined()
  })

  it('several whole days: the end is the LAST day (iCal’s end is the day after)', () => {
    expect(events.find((e) => e.uid.startsWith('winter-break'))).toMatchObject({
      allDay: true,
      start: '2026-12-21T05:00:00.000Z',
      end: '2027-01-01T05:00:00.000Z',
    })
  })

  it('only events in the range are read', () => {
    const november = parseFeed(fixture('google-recurring.ics'), {
      range: { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-30T00:00:00Z') },
      timeZone: NY,
    })
    expect(november.map((e) => e.title)).toEqual([
      'Soccer practice',
      'Soccer practice (moved indoors)',
      'Soccer practice',
    ])
  })

  it('stops at the cap however much a feed repeats', () => {
    expect(
      parseFeed(fixture('google-recurring.ics'), { range: YEAR, timeZone: NY, cap: 2 }),
    ).toHaveLength(2)
  })
})

describe('parseFeed — what is not a calendar', () => {
  it.each([
    ['empty', ''],
    ['an HTML sign-in page', '<!doctype html><html><body>Sign in</body></html>'],
  ])(
    '%s throws — so the sync keeps the last good copy instead of emptying the calendar',
    (_label, text) => {
      expect(() => parseFeed(text, { range: YEAR, timeZone: NY })).toThrow(
        /did not return an iCal calendar/,
      )
    },
  )

  it('a real calendar with no events is no events', () => {
    expect(
      parseFeed('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', {
        range: YEAR,
        timeZone: NY,
      }),
    ).toEqual([])
  })
})
