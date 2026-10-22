import { describe, expect, it } from 'vitest'

import {
  businessDaysBetween,
  describeWait,
  OVERDUE_BUSINESS_DAYS,
} from '@/admin/Approvals/queue-age'

/**
 * How long a submission has waited (`04` §4.2 "age"; §5 escalation).
 *
 * The threshold is business days — `04` §5 suggests 3 — so a page sent on Friday afternoon is
 * not "overdue" on Monday morning. Counted in the district's time zone.
 */

const TZ = 'America/New_York'

describe('businessDaysBetween', () => {
  it.each([
    // Thu 22 Oct 2026 → same day
    ['2026-10-22T13:00:00Z', '2026-10-22T20:00:00Z', 0],
    // Thu → Fri
    ['2026-10-22T13:00:00Z', '2026-10-23T13:00:00Z', 1],
    // Fri → Mon: the weekend does not count
    ['2026-10-23T13:00:00Z', '2026-10-26T13:00:00Z', 1],
    // Thu → next Thu
    ['2026-10-22T13:00:00Z', '2026-10-29T13:00:00Z', 5],
    // Sat → Mon
    ['2026-10-24T13:00:00Z', '2026-10-26T13:00:00Z', 1],
  ])('%s → %s is %i', (from, to, expected) => {
    expect(businessDaysBetween(new Date(from), new Date(to), TZ)).toBe(expected)
  })

  it('counts days in the district, not in UTC', () => {
    // 23:30 Eastern on Thu is already Fri in UTC; Thu evening → Fri morning is one day.
    expect(
      businessDaysBetween(new Date('2026-10-23T03:30:00Z'), new Date('2026-10-23T14:00:00Z'), TZ),
    ).toBe(1)
  })
})

describe('describeWait', () => {
  const now = new Date('2026-10-29T15:00:00Z') // Thursday

  it.each([
    ['2026-10-29T13:00:00Z', 'Sent today', false],
    ['2026-10-28T13:00:00Z', 'Sent yesterday', false],
    ['2026-10-26T13:00:00Z', 'Sent 3 days ago', false],
    // Thu 22 → Thu 29: five business days, past the threshold
    ['2026-10-22T13:00:00Z', 'Sent 7 days ago', true],
  ])('%s → %s (overdue: %s)', (sent, label, overdue) => {
    expect(describeWait(sent, now, TZ)).toEqual({ label, overdue })
  })

  it('the threshold is the spec suggestion of 3 business days', () => {
    expect(OVERDUE_BUSINESS_DAYS).toBe(3)
    // Fri 23 → Thu 29 is 4 business days: overdue. Mon 26 → Thu 29 is 3: not yet.
    expect(describeWait('2026-10-23T13:00:00Z', now, TZ).overdue).toBe(true)
    expect(describeWait('2026-10-26T13:00:00Z', now, TZ).overdue).toBe(false)
  })

  it('a missing or unreadable date says so rather than guessing', () => {
    expect(describeWait(null, now, TZ)).toEqual({
      label: 'Sent at an unknown time',
      overdue: false,
    })
    expect(describeWait('soon', now, TZ)).toEqual({
      label: 'Sent at an unknown time',
      overdue: false,
    })
  })
})
