import { describe, expect, it } from 'vitest'

import { toCalendarEvent } from '@/content/event-mapper'

/**
 * The events mapper (`03` §2, `02` §11) — a Payload `events` row to a DD2 `CalendarEvent`.
 *
 * Handed `unknown`. A row it cannot use is `null`, and the caller drops it: a calendar with one
 * event missing is a smaller failure than a calendar that does not render.
 */

const paragraph = (text: string) => ({
  root: {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', text, format: 0 }] }],
  },
})

const complete = {
  id: 7,
  tenant: { id: 3, name: 'School A' },
  calendar: { id: 9, name: 'School A' },
  title: ' Winter concert ',
  start: '2026-12-04T23:00:00.000Z',
  end: '2026-12-05T01:00:00.000Z',
  allDay: false,
  location: ' Auditorium ',
  repeat: 'none',
  repeatUntil: null,
  notes: paragraph('Doors open at 5:30.'),
  reviewState: 'submitted',
  _status: 'published',
}

describe('toCalendarEvent', () => {
  it('maps a complete row, and nothing about review crosses', () => {
    expect(toCalendarEvent(complete)).toEqual({
      id: '7',
      tenantId: '3',
      calendarId: '9',
      title: 'Winter concert',
      location: 'Auditorium',
      notes: [
        { kind: 'paragraph', children: [{ kind: 'text', text: 'Doors open at 5:30.', marks: [] }] },
      ],
      timing: {
        start: '2026-12-04T23:00:00.000Z',
        end: '2026-12-05T01:00:00.000Z',
        allDay: false,
        repeat: 'none',
        repeatUntil: null,
      },
    })
  })

  it('reads a blank location, end and notes as none', () => {
    const event = toCalendarEvent({ ...complete, location: '  ', end: null, notes: null })
    expect(event?.location).toBeNull()
    expect(event?.timing.end).toBeNull()
    expect(event?.notes).toEqual([])
  })

  it('keeps the repeat and its last date as a local date', () => {
    const event = toCalendarEvent({
      ...complete,
      repeat: 'weekly',
      // Payload stores a day-only date as an instant; the local date is what counts.
      repeatUntil: '2027-05-31T16:00:00.000Z',
    })
    expect(event?.timing).toMatchObject({ repeat: 'weekly', repeatUntil: '2027-05-31' })
  })

  it('reads an unknown repeat as none, never as a guess', () => {
    expect(toCalendarEvent({ ...complete, repeat: 'fortnightly' })?.timing.repeat).toBe('none')
  })

  it('reads a repeat with no last date as none', () => {
    expect(
      toCalendarEvent({ ...complete, repeat: 'weekly', repeatUntil: null })?.timing.repeat,
    ).toBe('none')
  })

  it('reads all day only from true', () => {
    expect(toCalendarEvent({ ...complete, allDay: true })?.timing.allDay).toBe(true)
    expect(toCalendarEvent({ ...complete, allDay: 'yes' })?.timing.allDay).toBe(false)
  })

  it.each([
    ['no id', { ...complete, id: undefined }],
    ['no tenant', { ...complete, tenant: null }],
    ['no calendar', { ...complete, calendar: null }],
    ['no title', { ...complete, title: ' ' }],
    ['no start', { ...complete, start: null }],
    ['a start that is not a date', { ...complete, start: 'soon' }],
  ])('is null for a row with %s', (_label, row) => {
    expect(toCalendarEvent(row)).toBeNull()
  })

  it('is null for something that is not a row', () => {
    expect(toCalendarEvent(null)).toBeNull()
    expect(toCalendarEvent('event')).toBeNull()
  })
})
