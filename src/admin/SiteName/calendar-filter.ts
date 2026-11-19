/**
 * The calendar an events list is filtered to, from its address (Jason, 2026-11-18) — PURE. The
 * Events panel writes `?where[calendar][equals]=<id>` (`calendarEventsHref`); Payload's own filter
 * may hand it on parsed. One id, digits only — anything else is no single calendar.
 */
const idOf = (value: unknown): string | null => {
  const text = typeof value === 'number' ? String(value) : value
  return typeof text === 'string' && /^\d+$/.test(text) ? text : null
}

export const calendarFilterOf = (params: unknown): string | null => {
  if (typeof params !== 'object' || params === null) return null
  const flat = (params as Record<string, unknown>)['where[calendar][equals]']
  if (flat !== undefined) return idOf(flat)
  const where = (params as { where?: { calendar?: { equals?: unknown } } }).where
  return idOf(where?.calendar?.equals)
}
