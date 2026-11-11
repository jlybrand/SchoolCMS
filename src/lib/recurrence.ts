/**
 * Event dates and repeats (Jason, 2026-11-11: "the same fields as Finalsite calendar events").
 *
 * Finalsite's Calendar Manager offers these Repeat choices — daily, week days, MWF, TTh, weekly,
 * monthly, yearly — so DD2 stores the CHOICE and a last date, not a free-form rule: a school
 * manager picks one of eight radios, and nothing can be typed that the calendar cannot draw.
 * `toRRule` writes the same thing as RFC 5545 for the iCal feed (`03` §2 `recurrence`).
 *
 * A repeat needs a last date. Without one the event happens once, so a slip cannot fill every
 * calendar for ever.
 *
 * EVERYTHING IS IN THE DISTRICT'S TIME ZONE. A 4 p.m. weekly meeting stays at 4 p.m. when the
 * clocks change, which stepping an instant by 7 × 24 hours would not do; and "the 4th" is the
 * 4th in Summerville, not in UTC. Dates are carried as `YYYY-MM-DD` strings so day arithmetic
 * never touches a time zone.
 *
 * Pure, so the calendar block, the event page and the iCal feed agree by construction.
 */

export type Repeat = 'none' | 'daily' | 'weekdays' | 'mwf' | 'tth' | 'weekly' | 'monthly' | 'yearly'

/** In the order Finalsite lists them. No ":" in a value — GraphQL refuses one. */
export const REPEAT_OPTIONS: readonly { value: Repeat; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday (Monday to Friday)' },
  { value: 'mwf', label: 'Every Monday, Wednesday and Friday' },
  { value: 'tth', label: 'Every Tuesday and Thursday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month, on the same date' },
  { value: 'yearly', label: 'Every year, on the same date' },
]

export const isRepeat = (value: unknown): value is Repeat =>
  REPEAT_OPTIONS.some((option) => option.value === value)

/** What an event says about when it happens, as stored. */
export type EventTiming = {
  /** ISO instant. For an all-day event, any instant on its first local date. */
  start: string
  /** ISO instant, or null — Finalsite lets the end time be blank. */
  end: string | null
  allDay: boolean
  repeat: Repeat
  /** `YYYY-MM-DD`, the last local date it may happen on; null = it does not repeat. */
  repeatUntil: string | null
}

/**
 * One time it happens. For a timed event `start`/`end` are ISO instants; for an all-day event
 * they are `YYYY-MM-DD` dates. `startDate`/`endDate` are always local dates, for placing it on a
 * grid — `endDate` equals `startDate` for an event inside one day.
 */
export type Occurrence = {
  start: string
  end: string | null
  startDate: string
  endDate: string
}

/** Inclusive at both ends, as local dates. */
export type DateRange = { from: string; to: string }

const DAY_MS = 24 * 60 * 60 * 1000

/** The most one event yields for one range — a guard, not a display limit. */
export const MAX_OCCURRENCES = 500

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

const partsIn = (ms: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

const toMs = (iso: string | null): number | null => {
  if (iso === null) return null
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** The local calendar date of an instant, as `YYYY-MM-DD`. */
export const localDateOf = (iso: string, timeZone: string): string => {
  const p = partsIn(new Date(iso).getTime(), timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

const dateParts = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return { y, m, d }
}

const utcOf = (date: string) => {
  const { y, m, d } = dateParts(date)
  return Date.UTC(y, m - 1, d)
}

const fromUtc = (ms: number) => {
  const at = new Date(ms)
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

export const addDays = (date: string, days: number): string => fromUtc(utcOf(date) + days * DAY_MS)

const daysBetween = (from: string, to: string) => Math.round((utcOf(to) - utcOf(from)) / DAY_MS)

/** 0 = Sunday … 6 = Saturday. */
const weekdayOf = (date: string) => new Date(utcOf(date)).getUTCDay()

/** The instant a local wall-clock time names. Twice-corrected, so it is exact either side of a change. */
export const zonedTime = (date: string, hour: number, minute: number, timeZone: string): string => {
  const { y, m, d } = dateParts(date)
  const wall = Date.UTC(y, m - 1, d, hour, minute)
  const offsetAt = (ms: number) => {
    const p = partsIn(ms, timeZone)
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms
  }
  let ms = wall - offsetAt(wall)
  ms = wall - offsetAt(ms)
  return new Date(ms).toISOString()
}

const WEEKDAYS: Partial<Record<Repeat, readonly number[]>> = {
  weekdays: [1, 2, 3, 4, 5],
  mwf: [1, 3, 5],
  tth: [2, 4],
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

const FREQ: Record<Exclude<Repeat, 'none'>, string> = {
  daily: 'DAILY',
  weekdays: 'WEEKLY',
  mwf: 'WEEKLY',
  tth: 'WEEKLY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
}

/**
 * The repeat as an RFC 5545 RRULE, or null when it does not repeat. UNTIL is the last second of
 * the last local day, in UTC — the form RFC 5545 requires beside a zoned DTSTART.
 */
export const toRRule = (repeat: Repeat, until: string | null, timeZone: string): string | null => {
  if (repeat === 'none' || until === null) return null
  const endMs = new Date(zonedTime(addDays(until, 1), 0, 0, timeZone)).getTime() - 1000
  const e = new Date(endMs)
  const stamp =
    `${e.getUTCFullYear()}${pad(e.getUTCMonth() + 1)}${pad(e.getUTCDate())}` +
    `T${pad(e.getUTCHours())}${pad(e.getUTCMinutes())}${pad(e.getUTCSeconds())}Z`
  const days = WEEKDAYS[repeat]
  const byDay = days ? `;BYDAY=${days.map((day) => BYDAY[day]).join(',')}` : ''
  return `FREQ=${FREQ[repeat]}${byDay};UNTIL=${stamp}`
}

/** Local start dates on which a repeat happens, from its first date to `last`, in order. */
function* startDates(first: string, repeat: Repeat, last: string): Generator<string> {
  if (repeat === 'monthly' || repeat === 'yearly') {
    const { y, m, d } = dateParts(first)
    for (let step = 0; ; step += 1) {
      const months = repeat === 'monthly' ? step : step * 12
      const year = y + Math.floor((m - 1 + months) / 12)
      const month = ((m - 1 + months) % 12) + 1
      // A month without the date (the 31st, 29 February) is skipped, as RFC 5545 does.
      const candidate = `${year}-${pad(month)}-${pad(d)}`
      if (candidate > last) return
      if (fromUtc(utcOf(candidate)) === candidate) yield candidate
    }
  }
  const days = WEEKDAYS[repeat]
  const step = repeat === 'weekly' ? 7 : 1
  for (let date = first; date <= last; date = addDays(date, step)) {
    if (!days || days.includes(weekdayOf(date))) yield date
  }
}

/**
 * Every time `timing` happens that overlaps `range`, earliest first, at most `cap`.
 * A start that is not a date yields nothing; an end before the start is read as no end.
 */
export const occurrences = (
  timing: EventTiming,
  range: DateRange,
  timeZone: string,
  cap = MAX_OCCURRENCES,
): Occurrence[] => {
  const startMs = toMs(timing.start)
  if (startMs === null) return []
  const endMsRaw = toMs(timing.end)
  const endMs = endMsRaw !== null && endMsRaw >= startMs ? endMsRaw : null

  const firstDate = localDateOf(timing.start, timeZone)
  const lastEndDate =
    endMs === null ? firstDate : localDateOf(new Date(endMs).toISOString(), timeZone)
  const spanDays = Math.max(0, daysBetween(firstDate, lastEndDate))

  const repeats = timing.repeat !== 'none' && timing.repeatUntil !== null
  const lastStart = repeats ? (timing.repeatUntil as string) : firstDate
  // Nothing starting after the range's end can overlap it.
  const last = lastStart < range.to ? lastStart : range.to

  const { hour, minute } = partsIn(startMs, timeZone)
  const duration = endMs === null ? null : endMs - startMs

  const out: Occurrence[] = []
  const dates = repeats ? startDates(firstDate, timing.repeat, last) : [firstDate].values()
  for (const startDate of dates) {
    if (startDate > last) break
    const endDate = addDays(startDate, spanDays)
    if (endDate < range.from) continue
    if (timing.allDay) {
      out.push({ start: startDate, end: endMs === null ? null : endDate, startDate, endDate })
    } else {
      const start =
        startDate === firstDate
          ? new Date(startMs).toISOString()
          : zonedTime(startDate, hour, minute, timeZone)
      const end =
        duration === null ? null : new Date(new Date(start).getTime() + duration).toISOString()
      out.push({
        start,
        end,
        startDate,
        endDate: end === null ? startDate : localDateOf(end, timeZone),
      })
    }
    if (out.length >= cap) break
  }
  return out
}
