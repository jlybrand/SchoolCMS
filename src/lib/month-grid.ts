import { addDays, type DateRange } from './recurrence'

/**
 * A month as a paper calendar lays it out (Jason, 2026-11-11: the calendar block's grid view).
 * Pure; dates are `YYYY-MM-DD` and months `YYYY-MM`, so nothing here touches a time zone.
 *
 * Weeks start on Sunday, as US school calendars do. The locale changes the day NAMES, not the
 * first day — a translated page shows the same calendar as the English one.
 */

const pad = (n: number) => String(n).padStart(2, '0')

const parts = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return { y, m }
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** `count` months, starting with the one `today` is in. */
export const monthsFrom = (today: string, count: number): string[] => {
  const { y, m } = parts(today.slice(0, 7))
  return Array.from({ length: count }, (_, i) => {
    const index = m - 1 + i
    return `${y + Math.floor(index / 12)}-${pad((index % 12) + 1)}`
  })
}

export const monthRange = (month: string): DateRange => {
  const { y, m } = parts(month)
  return { from: `${month}-01`, to: `${month}-${pad(daysIn(y, m))}` }
}

/** Weeks of seven days; a day outside the month is null. */
export const monthGrid = (month: string): (string | null)[][] => {
  const { y, m } = parts(month)
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysIn(y, m) }, (_, i) => `${month}-${pad(i + 1)}`),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
}

/**
 * Each item on every day from its start to its end, keeping the order given. `maxDays` caps a
 * long run, so one mis-dated event cannot fill every cell of a year.
 */
export const spreadByDay = <T extends { startDate: string; endDate: string }>(
  items: readonly T[],
  maxDays = 62,
): Map<string, T[]> => {
  const byDay = new Map<string, T[]>()
  for (const item of items) {
    let day = item.startDate
    for (let n = 0; n < maxDays && day <= item.endDate; n += 1, day = addDays(day, 1)) {
      const list = byDay.get(day)
      if (list) list.push(item)
      else byDay.set(day, [item])
    }
  }
  return byDay
}
