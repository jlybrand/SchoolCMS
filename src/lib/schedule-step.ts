/**
 * Scheduled times come in five-minute steps (Jason, 2026-11-13). The schedule job
 * (`src/collections/endpoints/schedule.ts`) runs on the five minutes, so a Start, Expires or
 * Featured until set on a step happens within seconds of it — one set for 08:41 waited until
 * 08:45, and looked broken. The pickers offer only the steps (a Time list, below), and the
 * dialogs refuse a time between them that arrives some other way. PURE.
 *
 * Steps are counted in UTC minutes: every time zone's offset is a whole number of five minutes,
 * so a step in UTC is a step on the district's clock too.
 */

export const SCHEDULE_STEP_MINUTES = 5

const STEP_MS = SCHEDULE_STEP_MINUTES * 60 * 1000

/** When the schedule job runs — on the same steps the pickers offer. */
export const SCHEDULE_CRON = `*/${SCHEDULE_STEP_MINUTES} * * * *`

export const STEP_REFUSAL = 'Choose a time in five-minute steps, like 9:00, 9:05 or 9:10.'

/** Whether a time falls on a step, to the second. */
export const onScheduleStep = (at: Date): boolean => at.getTime() % STEP_MS === 0

/**
 * The step refusal for each date set between steps. Unset and unreadable dates are left alone:
 * their own checks (`checkPostDates`) say what is wrong with them.
 */
export const stepErrors = <K extends string>(
  dates: Partial<Record<K, string | null>>,
): Partial<Record<K, string>> => {
  const errors: Partial<Record<K, string>> = {}
  for (const [field, value] of Object.entries(dates) as [K, string | null | undefined][]) {
    if (!value) continue
    const at = new Date(value)
    if (Number.isNaN(at.getTime())) continue
    if (!onScheduleStep(at)) errors[field] = STEP_REFUSAL
  }
  return errors
}

/*
 * The picker (2026-11-13): a day box and a Time list. The browser's own day-and-time box ignores
 * `step` in the list it draws, so it offered every minute; a `<select>` offers only the steps.
 * The value is still a `datetime-local` string ("2026-11-13T08:40"), which the dialogs keep.
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** Every step of the day as "HH:MM" — 00:00 to 23:55. */
export const stepTimes = (): string[] =>
  Array.from({ length: (24 * 60) / SCHEDULE_STEP_MINUTES }, (_, i) => {
    const minutes = i * SCHEDULE_STEP_MINUTES
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
  })

/** "09:05" as the reader's clock shows it ("9:05 AM"). */
export const timeLabel = (time: string, locale?: string): string => {
  const [h, m] = time.split(':').map(Number)
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, h, m)))
}

/** A `datetime-local` value as its day and time; either may be empty. */
export const splitLocal = (value: string): { day: string; time: string } => {
  const [day = '', time = ''] = value.split('T')
  return { day, time: time.slice(0, 5) }
}

/**
 * The day and time as one `datetime-local` value. Half a choice is kept ("2026-11-13T"), so
 * nothing chosen is lost, and it is not a date — "Choose a day and time." until both are made.
 */
export const joinLocal = (day: string, time: string): string =>
  day === '' && time === '' ? '' : `${day}T${time}`
