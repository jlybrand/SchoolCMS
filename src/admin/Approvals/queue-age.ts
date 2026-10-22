/**
 * How long a submission has waited (`04` §4.2 "age", §5 escalation).
 *
 * Overdue is counted in BUSINESS days — `04` §5 suggests 3 — so a Friday-afternoon submission is
 * not overdue on Monday. Calendar days are what the label says, because "sent 4 days ago" is
 * what a person means. Both in the district's time zone. The escalation email that fires on
 * `overdue` is the notifications slice; this is the queue's marker.
 */

export const OVERDUE_BUSINESS_DAYS = 3

/** The calendar date in `timeZone`, as a UTC-midnight timestamp so days subtract cleanly. */
const localDay = (date: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'))
}

const DAY = 24 * 60 * 60 * 1000

/** Weekdays after `from`'s date, up to and including `to`'s date. Holidays are not modelled. */
export const businessDaysBetween = (from: Date, to: Date, timeZone: string): number => {
  const start = localDay(from, timeZone)
  const end = localDay(to, timeZone)
  let count = 0
  for (let day = start + DAY; day <= end; day += DAY) {
    const weekday = new Date(day).getUTCDay()
    if (weekday !== 0 && weekday !== 6) count += 1
  }
  return count
}

export type Wait = { label: string; overdue: boolean }

export const describeWait = (sentAt: unknown, now: Date, timeZone: string): Wait => {
  const sent = typeof sentAt === 'string' ? new Date(sentAt) : null
  if (!sent || Number.isNaN(sent.getTime())) {
    return { label: 'Sent at an unknown time', overdue: false }
  }

  const days = Math.round((localDay(now, timeZone) - localDay(sent, timeZone)) / DAY)
  const label = days <= 0 ? 'Sent today' : days === 1 ? 'Sent yesterday' : `Sent ${days} days ago`
  return { label, overdue: businessDaysBetween(sent, now, timeZone) > OVERDUE_BUSINESS_DAYS }
}
