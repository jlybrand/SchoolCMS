import { describe, expect, it } from 'vitest'

import { checkEventDates } from '@/lib/event-dates'

/**
 * The rules an event's dates must keep before it can be saved — refused in words, on the field
 * that is wrong, so a school manager knows what to change. Applied by `eventDatesHook` on every
 * write, admin and API alike.
 */

const NY = 'America/New_York'
const base = {
  start: '2026-12-04T23:00:00.000Z',
  end: null,
  allDay: false,
  repeat: 'none',
  repeatUntil: null,
}

describe('checkEventDates', () => {
  it('accepts an event with only a start — Finalsite lets the end be blank', () => {
    expect(checkEventDates(base, NY)).toEqual({ ok: true })
  })

  it('accepts an end after the start', () => {
    expect(checkEventDates({ ...base, end: '2026-12-05T01:00:00.000Z' }, NY)).toEqual({ ok: true })
  })

  it('refuses an end before the start', () => {
    expect(checkEventDates({ ...base, end: '2026-12-04T22:00:00.000Z' }, NY)).toEqual({
      ok: false,
      errors: { end: 'The end can’t be before the start.' },
    })
  })

  it('all day compares the DATES: an end on the same day is fine whatever its time', () => {
    const allDay = { ...base, allDay: true, start: '2026-12-21T05:00:00.000Z' }
    expect(checkEventDates({ ...allDay, end: '2026-12-21T04:59:00.000Z' }, NY)).toEqual({
      ok: false,
      errors: { end: 'The last day can’t be before the first.' },
    })
    expect(checkEventDates({ ...allDay, end: '2026-12-21T16:00:00.000Z' }, NY)).toEqual({
      ok: true,
    })
  })

  it('refuses a repeat without a last date', () => {
    expect(checkEventDates({ ...base, repeat: 'weekly' }, NY)).toEqual({
      ok: false,
      errors: { repeatUntil: 'Choose the last date it repeats on.' },
    })
  })

  it('refuses a last date before the event’s first day', () => {
    expect(
      checkEventDates({ ...base, repeat: 'weekly', repeatUntil: '2026-12-03T16:00:00.000Z' }, NY),
    ).toEqual({
      ok: false,
      errors: { repeatUntil: 'The last date can’t be before the event’s first day.' },
    })
  })

  it('accepts a last date on the first day itself', () => {
    expect(
      checkEventDates({ ...base, repeat: 'weekly', repeatUntil: '2026-12-04T16:00:00.000Z' }, NY),
    ).toEqual({ ok: true })
  })

  it('ignores a last date when it does not repeat', () => {
    expect(checkEventDates({ ...base, repeatUntil: '2020-01-01T16:00:00.000Z' }, NY)).toEqual({
      ok: true,
    })
  })

  it('refuses an unknown repeat', () => {
    expect(checkEventDates({ ...base, repeat: 'fortnightly' }, NY)).toEqual({
      ok: false,
      errors: { repeat: 'Choose how often it repeats.' },
    })
  })

  it('leaves a missing start to the field’s own required rule', () => {
    expect(checkEventDates({ ...base, start: null }, NY)).toEqual({ ok: true })
  })

  it('reports every wrong field at once', () => {
    const result = checkEventDates(
      { ...base, end: '2026-12-04T22:00:00.000Z', repeat: 'daily', repeatUntil: null },
      NY,
    )
    expect(result).toEqual({
      ok: false,
      errors: {
        end: 'The end can’t be before the start.',
        repeatUntil: 'Choose the last date it repeats on.',
      },
    })
  })
})
