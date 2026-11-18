import { describe, expect, it } from 'vitest'

import { calendarFilterOf } from '@/admin/SiteName/calendar-filter'

/**
 * The calendar an events list is filtered to (Jason, 2026-11-18: Events → a calendar → a list
 * with no word of whose calendar it is) — PURE: read from the list's address, as the Events panel
 * writes it (`calendarEventsHref`) or as Payload's own filter does.
 */
describe('calendarFilterOf', () => {
  it('the flat key the Events panel writes', () => {
    expect(calendarFilterOf({ 'where[calendar][equals]': '51' })).toBe('51')
  })

  it('the nested shape, once parsed', () => {
    expect(calendarFilterOf({ where: { calendar: { equals: '51' } } })).toBe('51')
    expect(calendarFilterOf({ where: { calendar: { equals: 51 } } })).toBe('51')
  })

  it('nothing else: no filter, another field, an `in` list, a non-id', () => {
    for (const params of [
      undefined,
      {},
      { where: { title: { equals: 'x' } } },
      { where: { calendar: { in: ['51', '52'] } } },
      { 'where[calendar][equals]': 'abc' },
      { 'where[calendar][equals]': ['51', '52'] },
    ]) {
      expect(calendarFilterOf(params), JSON.stringify(params)).toBeNull()
    }
  })
})
