import { describe, expect, it } from 'vitest'

import type { CalendarEvent } from '@/content/types'
import {
  calendarFeedPath,
  escapeText,
  foldLine,
  plainTextOf,
  subscribeUrl,
  toICalendar,
} from '@/lib/ical'

/**
 * A calendar as an iCalendar feed (RFC 5545) — what Google, Outlook and Apple Calendar subscribe
 * to (Jason, 2026-11-11). Pure; the route only serves it.
 *
 * Times are written in the district's zone with a VTIMEZONE, not in UTC: a weekly 4 p.m. meeting
 * must stay at 4 p.m. across daylight saving in the subscriber's app, which a UTC start with an
 * RRULE would not do.
 */

const NY = 'America/New_York'
const NOW = new Date('2026-11-11T15:00:00.000Z')

const event = (
  overrides: Partial<Omit<CalendarEvent, 'timing'>> & {
    timing?: Partial<CalendarEvent['timing']>
  } = {},
): CalendarEvent => {
  const { timing, ...rest } = overrides
  return {
    id: '7',
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
      repeat: 'none',
      repeatUntil: null,
      ...timing,
    },
  }
}

const feed = (events: CalendarEvent[]) =>
  toICalendar({ name: 'School A', events, domain: 'a.dd2.org', now: NOW, timeZone: NY })

/** The unfolded lines of one VEVENT. */
const veventOf = (ics: string) => {
  const unfolded = ics.replace(/\r\n /g, '')
  const start = unfolded.indexOf('BEGIN:VEVENT')
  const end = unfolded.indexOf('END:VEVENT', start)
  return unfolded.slice(start, end).split('\r\n')
}

describe('toICalendar — the calendar', () => {
  const ics = feed([event()])

  it('is one VCALENDAR with CRLF line endings, ending in CRLF', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('says what it is, and names itself after the calendar', () => {
    expect(ics).toContain('VERSION:2.0\r\n')
    expect(ics).toContain('PRODID:-//DD2//Website calendars//EN\r\n')
    expect(ics).toContain('CALSCALE:GREGORIAN\r\n')
    expect(ics).toContain('METHOD:PUBLISH\r\n')
    expect(ics).toContain('X-WR-CALNAME:School A\r\n')
    expect(ics).toContain('X-WR-TIMEZONE:America/New_York\r\n')
  })

  it('defines the district’s time zone, with its daylight-saving rules', () => {
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\n')
    expect(ics).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU')
    expect(ics).toContain('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU')
  })

  it('an empty calendar is still a valid calendar', () => {
    const empty = feed([])
    expect(empty).toContain('BEGIN:VCALENDAR')
    expect(empty).not.toContain('BEGIN:VEVENT')
  })
})

describe('toICalendar — an event', () => {
  it('a timed event: local start and end in the district’s zone, a stable UID, a stamp', () => {
    expect(veventOf(feed([event()]))).toEqual([
      'BEGIN:VEVENT',
      'UID:event-7@a.dd2.org',
      'DTSTAMP:20261111T150000Z',
      'DTSTART;TZID=America/New_York:20261204T180000',
      'DTEND;TZID=America/New_York:20261204T200000',
      'SUMMARY:Winter concert',
      'LOCATION:Auditorium',
      '',
    ])
  })

  it('no end: a start alone, as Finalsite allows', () => {
    const lines = veventOf(feed([event({ timing: { end: null } })]))
    expect(lines).toContain('DTSTART;TZID=America/New_York:20261204T180000')
    expect(lines.some((l) => l.startsWith('DTEND'))).toBe(false)
  })

  it('all day: dates, the end the day AFTER the last (RFC 5545 ends are exclusive)', () => {
    const lines = veventOf(
      feed([
        event({
          timing: {
            allDay: true,
            start: '2026-12-21T05:00:00.000Z',
            end: '2027-01-01T05:00:00.000Z',
          },
        }),
      ]),
    )
    expect(lines).toContain('DTSTART;VALUE=DATE:20261221')
    expect(lines).toContain('DTEND;VALUE=DATE:20270102')
  })

  it('one whole day with no end still ends the next day', () => {
    const lines = veventOf(
      feed([event({ timing: { allDay: true, start: '2026-12-21T05:00:00.000Z', end: null } })]),
    )
    expect(lines).toContain('DTEND;VALUE=DATE:20261222')
  })

  it('a repeat carries its RRULE', () => {
    const lines = veventOf(
      feed([event({ timing: { end: null, repeat: 'mwf', repeatUntil: '2027-05-31' } })]),
    )
    expect(lines).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20270601T035959Z')
  })

  it('notes become the description, as plain text', () => {
    const lines = veventOf(
      feed([
        event({
          notes: [
            { kind: 'paragraph', children: [{ kind: 'text', text: 'Doors at 5:30.', marks: [] }] },
            {
              kind: 'list',
              ordered: false,
              items: [{ children: [{ kind: 'text', text: 'Bring a coat', marks: [] }] }],
            } as never,
          ],
        }),
      ]),
    )
    expect(lines).toContain('DESCRIPTION:Doors at 5:30.\\n\\n- Bring a coat')
  })

  it('no location and no notes: neither line', () => {
    const lines = veventOf(feed([event({ location: null })]))
    expect(lines.some((l) => l.startsWith('LOCATION'))).toBe(false)
    expect(lines.some((l) => l.startsWith('DESCRIPTION'))).toBe(false)
  })
})

describe('escapeText — RFC 5545 §3.3.11', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeText('a\\b; c, d\ne\r\nf')).toBe('a\\\\b\\; c\\, d\\ne\\nf')
  })
})

describe('foldLine — 75 octets a line, continued with a space', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:Short')).toBe('SUMMARY:Short')
  })

  it('folds a long line at 75 octets', () => {
    const line = `SUMMARY:${'x'.repeat(100)}`
    const folded = foldLine(line).split('\r\n')
    expect(folded[0]).toHaveLength(75)
    expect(folded[1]!.startsWith(' ')).toBe(true)
    expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(line)
  })

  it('never splits a multi-byte character', () => {
    const line = `SUMMARY:${'é'.repeat(60)}`
    for (const part of foldLine(line).split('\r\n')) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
      expect(part).not.toContain('�')
    }
    expect(
      foldLine(line)
        .split('\r\n')
        .map((l, i) => (i === 0 ? l : l.slice(1)))
        .join(''),
    ).toBe(line)
  })
})

describe('plainTextOf', () => {
  it('a link keeps its address in brackets', () => {
    expect(
      plainTextOf([
        {
          kind: 'paragraph',
          children: [
            { kind: 'text', text: 'Tickets ', marks: [] },
            {
              kind: 'link',
              href: 'https://dd2.org/tickets',
              newTab: false,
              children: [{ kind: 'text', text: 'here', marks: [] }],
            },
          ],
        },
      ]),
    ).toBe('Tickets here (https://dd2.org/tickets)')
  })
})

describe('the subscribe address', () => {
  it('a calendar’s feed lives at /calendars/<id>.ics', () => {
    expect(calendarFeedPath('12')).toBe('/calendars/12.ics')
  })

  it('subscribe is webcal:// on the calendar’s own site — calendar apps subscribe on it', () => {
    expect(subscribeUrl('https://admin.dd2.org', 'a.dd2.org', '12')).toBe(
      'webcal://a.dd2.org/calendars/12.ics',
    )
  })

  it('keeps a developer’s port, as approval emails do', () => {
    expect(subscribeUrl('http://localhost:3000', 'a.localhost', '12')).toBe(
      'webcal://a.localhost:3000/calendars/12.ics',
    )
  })
})
