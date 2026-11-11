import { relationshipIdOf, tenantIdOf } from '@/access/predicates'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'
import { isRepeat, localDateOf, type Repeat } from '@/lib/recurrence'

import { toRichText } from './rich-text'
import type { CalendarEvent } from './types'

/**
 * A Payload `events` row to a DD2 `CalendarEvent` (`02` §11). Pure, so the Phase 9 migration
 * mappers can run it with no CMS (`10` §5).
 *
 * Returns null for a row it cannot use — no id, tenant, calendar, title or start — and the caller
 * drops it. Nothing about review crosses: the renderer is handed what to show, never how it got
 * there.
 */

const text = (value: unknown): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed === '' ? null : trimmed
}

const instant = (value: unknown): string | null => {
  const raw = text(value)
  if (raw === null) return null
  const at = new Date(raw)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

export const toCalendarEvent = (row: unknown): CalendarEvent | null => {
  if (typeof row !== 'object' || row === null) return null
  const doc = row as Record<string, unknown>

  const id = doc.id === undefined || doc.id === null ? null : String(doc.id)
  const tenantId = tenantIdOf(doc.tenant as never)
  const calendarId = relationshipIdOf(doc.calendar as never)
  const title = text(doc.title)
  const start = instant(doc.start)
  if (id === null || tenantId === null || calendarId === null || title === null || start === null) {
    return null
  }

  const until = instant(doc.repeatUntil)
  const repeatUntil = until === null ? null : localDateOf(until, DISTRICT_TIME_ZONE)
  // A repeat with no last date happens once (`src/lib/recurrence.ts`), and says so here.
  const repeat: Repeat = isRepeat(doc.repeat) && repeatUntil !== null ? doc.repeat : 'none'

  return {
    id,
    tenantId,
    calendarId,
    title,
    location: text(doc.location),
    notes: toRichText(doc.notes),
    timing: {
      start,
      end: instant(doc.end),
      allDay: doc.allDay === true,
      repeat,
      repeatUntil: repeat === 'none' ? null : repeatUntil,
    },
  }
}
