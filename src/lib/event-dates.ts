import { isRepeat, localDateOf } from './recurrence'

/**
 * What an event's dates must be before it is saved (Jason, 2026-11-11). Pure; applied by
 * `eventDatesHook` (src/collections/hooks/event-hooks.ts) on every write, so the API cannot
 * store an event the calendar would have to guess about.
 *
 * Each refusal names the field that is wrong and says what to do, in the words the form uses.
 */

export type EventDatesInput = {
  start: unknown
  end: unknown
  allDay: unknown
  repeat: unknown
  repeatUntil: unknown
}

export type EventDatesCheck = { ok: true } | { ok: false; errors: Record<string, string> }

const instant = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null
  const at = new Date(value instanceof Date ? value : String(value))
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

export const checkEventDates = (input: EventDatesInput, timeZone: string): EventDatesCheck => {
  const errors: Record<string, string> = {}
  const start = instant(input.start)
  const end = instant(input.end)
  const allDay = input.allDay === true

  if (start !== null && end !== null) {
    if (allDay) {
      if (localDateOf(end, timeZone) < localDateOf(start, timeZone)) {
        errors.end = 'The last day can’t be before the first.'
      }
    } else if (end < start) {
      errors.end = 'The end can’t be before the start.'
    }
  }

  const repeat = input.repeat ?? 'none'
  if (!isRepeat(repeat)) {
    errors.repeat = 'Choose how often it repeats.'
  } else if (repeat !== 'none') {
    const until = instant(input.repeatUntil)
    if (until === null) {
      errors.repeatUntil = 'Choose the last date it repeats on.'
    } else if (start !== null && localDateOf(until, timeZone) < localDateOf(start, timeZone)) {
      errors.repeatUntil = 'The last date can’t be before the event’s first day.'
    }
  }

  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors }
}
