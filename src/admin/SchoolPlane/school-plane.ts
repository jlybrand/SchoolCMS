import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'
import { zonedTime } from '@/lib/recurrence'

/**
 * The pure decisions under the school plane's landing view and new-page form (`04` §2.2,
 * §2.4). The views in this directory render these; they decide nothing themselves.
 *
 * Wording rule throughout (`04` §2.1): no "collection", no "draft", no "publish". The user is
 * a school manager who last logged in five months ago.
 */

export type SchoolTask = { label: string; description: string; href: string }

/**
 * The tasks on the landing view, in `04` §2.2's order.
 *
 * Only the ones that work today. `04` §2.2 also lists "Add a meeting date", "Upload a document"
 * and "Add a photo"; each joins this list with its module (events in Phase 5, documents and
 * media in Phase 6). A task that leads nowhere would teach the user that the list lies.
 */
export const SCHOOL_TASKS: readonly SchoolTask[] = [
  {
    label: 'Post an announcement',
    description: 'Share news with families on your school’s website.',
    href: '/admin/new-post',
  },
  {
    // `04` §2.2's "Add a meeting date", in Jason's words (2026-11-11).
    label: 'Add an event',
    description: 'Put a date on your school’s calendar.',
    href: '/admin/new-event',
  },
  {
    label: 'Update a page',
    description: 'Change the words on a page of your school’s website.',
    href: '/admin/update-page',
  },
  {
    label: 'Add a page',
    description: 'Start a new page. The district places it on the site when they approve it.',
    href: '/admin/new-page',
  },
  {
    // "Upload", never "create" (Jason, 2026-11-13).
    label: 'Upload a file',
    description: 'Add an image or a document to your school’s library.',
    href: '/admin/upload-file',
  },
  {
    // Jason, 2026-11-16: a new version in the old one's place, the same kind only.
    label: 'Replace a file',
    description:
      'Put up a new version of a menu, form or image. Pages using it update by themselves.',
    href: '/admin/replace-file',
  },
  {
    // Jason, 2026-11-17: the file library, where a file is seen and changed in place.
    label: 'Manage your files',
    description:
      'See your school’s images and documents. Change their details, move, replace or delete them.',
    href: '/admin/file-library',
  },
]

export type ListTask = { label: string; href: string }

/** Which landing-view task a list's create button stands for. */
const LIST_TASK_HREFS: Readonly<Record<string, string>> = {
  // Not `posts`: News and announcements is its own screen, with "Create post" on each board.
  pages: '/admin/new-page',
  events: '/admin/new-event',
  resources: '/admin/upload-file',
}

/**
 * The create button a school manager gets on a list (Jason, 2026-11-04). Payload's own "Create
 * New" never appears for them: create access needs a school to check against, and Payload asks
 * with none. The task screens are their way to create anyway, so the list leads there — taken
 * from `SCHOOL_TASKS`, so the button and the landing view say the same thing.
 */
export const listTaskFor = (collection: string): ListTask | null => {
  const task = SCHOOL_TASKS.find((t) => t.href === LIST_TASK_HREFS[collection])
  return task ? { label: task.label, href: task.href } : null
}

/** The school (or schools) shown in place of a tenant picker; null when there is none. */
export const schoolNamesLabel = (names: readonly string[]): string | null =>
  names.length === 0 ? null : names.join(', ')

/** Longer than this is not a heading; the slug and the menu label are both built from it. */
const MAX_TITLE = 120

type SchoolId = number | string

export type NewPageInput = {
  title?: unknown
  /** The schools the user is assigned to. */
  schools: readonly SchoolId[]
  /** The school chosen in the form, when there was a choice. */
  school?: unknown
}

export type NewPageCheck =
  | { ok: true; title: string; school: SchoolId }
  | { ok: false; errors: Partial<Record<'title' | 'school', string>> }

const NO_SCHOOL = 'Your account is not linked to a school yet. Ask the district web team to add it.'
const CHOOSE_SCHOOL = 'Choose which school this page is for.'

const checkTitle = (value: unknown, missing: string): { title: string; error?: string } => {
  const title = typeof value === 'string' ? value.trim() : ''
  if (title === '') return { title, error: missing }
  if (title.length > MAX_TITLE)
    return { title, error: `Please make the title shorter — ${MAX_TITLE} characters at most.` }
  return { title }
}

/**
 * The school is never asked when there is one (`04` §2.2: "Tenant is already resolved from the
 * user's assignment — never asked"). With several, asking is the only honest option. Server-side
 * access still decides; this is the form's half.
 */
const checkSchool = (
  input: { schools: readonly SchoolId[]; school?: unknown },
  choose: string,
): { school?: SchoolId; error?: string } => {
  if (input.schools.length === 0) return { error: NO_SCHOOL }
  if (input.schools.length === 1 && (input.school === undefined || input.school === '')) {
    return { school: input.schools[0]! }
  }
  const school = input.schools.find((id) => String(id) === String(input.school))
  return school === undefined ? { error: choose } : { school }
}

/**
 * What a new page needs before it is created. Every problem is reported at once, so the form
 * never makes someone fix one thing only to be told about the next.
 */
export const checkNewPage = (input: NewPageInput): NewPageCheck => {
  const errors: Partial<Record<'title' | 'school', string>> = {}

  const title = checkTitle(input.title, 'Give the page a title.')
  if (title.error) errors.title = title.error

  const school = checkSchool(input, CHOOSE_SCHOOL)
  if (school.error) errors.school = school.error

  if (Object.keys(errors).length > 0 || school.school === undefined) return { ok: false, errors }
  return { ok: true, title: title.title, school: school.school }
}

/** A board the user may post to, and the school it belongs to. */
export type BoardChoice = { id: number | string; tenant: SchoolId }

export type NewPostInput = {
  title?: unknown
  /** Every board of the user's schools. */
  boards: readonly BoardChoice[]
  /** The board chosen in the form, when there was a choice. */
  board?: unknown
}

export type NewPostCheck =
  | { ok: true; title: string; board: number | string; school: SchoolId }
  | { ok: false; errors: Partial<Record<'title' | 'board', string>> }

const NO_BOARD =
  'Your school has no boards for announcements yet. Ask the district web team to set one up.'

/**
 * What a new announcement needs before it is created: a headline, and the board it goes on
 * (Jason, 2026-10-28: one board per post). The school follows from the board — boards are per
 * site — so it is never asked separately. With one board, the board is not asked either.
 *
 * Its words are written on the next screen, where autosave covers them.
 */
export const checkNewPost = (input: NewPostInput): NewPostCheck => {
  const errors: Partial<Record<'title' | 'board', string>> = {}
  const title = checkTitle(input.title, 'Give the announcement a headline.')
  if (title.error) errors.title = title.error

  let board: BoardChoice | undefined
  if (input.boards.length === 0) errors.board = NO_BOARD
  else if (input.boards.length === 1 && (input.board === undefined || input.board === '')) {
    board = input.boards[0]
  } else {
    board = input.boards.find((b) => String(b.id) === String(input.board))
    if (!board) errors.board = 'Choose which board this goes on.'
  }

  if (Object.keys(errors).length > 0 || !board) return { ok: false, errors }
  return { ok: true, title: title.title, board: board.id, school: board.tenant }
}

const TITLE_TAKEN = 'There is already a page with this title. Try a different title.'
const NOT_ALLOWED =
  'Your account cannot add pages to this school. Ask the district web team for help.'
const GENERIC = 'The page could not be created. Please try again in a moment.'

/**
 * A refused create, explained. Reads the REST error body in both shapes it arrives in: the
 * development build carries `data.errors[].path`; the production build currently drops it and
 * leaves only "The following field is invalid: X" (see `docs/phases/03` §24), so the field name
 * is read from the message as well.
 *
 * A slug problem is reported as a title problem, because the title is what the user typed —
 * they never see the slug.
 */
export const explainCreateError = (body: unknown): string => {
  const errors = (body as { errors?: unknown } | null)?.errors
  if (!Array.isArray(errors)) return GENERIC

  for (const error of errors as {
    message?: unknown
    data?: { errors?: { path?: unknown }[] }
  }[]) {
    const paths = (error?.data?.errors ?? []).map((e) => e?.path)
    const message = typeof error?.message === 'string' ? error.message : ''
    if (paths.includes('slug') || /field is invalid: slug\b/.test(message)) return TITLE_TAKEN
    if (/not allowed/i.test(message)) return NOT_ALLOWED
  }
  return GENERIC
}

const POST_NOT_ALLOWED =
  'Your account cannot post announcements for this school. Ask the district web team for help.'
const POST_GENERIC = 'The announcement could not be created. Please try again in a moment.'

/**
 * A refused announcement create, explained. Unlike a page, a repeated headline is never the
 * problem — the address is numbered (`uniquePostSlug`).
 */
export const explainPostCreateError = (body: unknown): string => {
  const errors = (body as { errors?: unknown } | null)?.errors
  if (!Array.isArray(errors)) return POST_GENERIC
  for (const error of errors as { message?: unknown }[]) {
    if (typeof error?.message === 'string' && /not allowed/i.test(error.message)) {
      return POST_NOT_ALLOWED
    }
  }
  return POST_GENERIC
}

/** A calendar the user may add to, and the school it belongs to. */
export type CalendarChoice = { id: number | string; tenant: SchoolId }

export type NewEventInput = {
  title?: unknown
  /** `YYYY-MM-DD`, from `<input type="date">`. */
  date?: unknown
  /** `HH:MM`, from `<input type="time">`; empty for an all-day event. */
  time?: unknown
  /** Every calendar of the user's schools. */
  calendars: readonly CalendarChoice[]
  /** The calendar chosen in the form, when there was a choice. */
  calendar?: unknown
}

export type NewEventCheck =
  | {
      ok: true
      title: string
      /** ISO instant: the day and time in the district's time zone. */
      start: string
      allDay: boolean
      calendar: number | string
      school: SchoolId
    }
  | { ok: false; errors: Partial<Record<'title' | 'date' | 'time' | 'calendar', string>> }

const NO_CALENDAR = 'Your school has no calendar yet. Ask the district web team to set one up.'

const realDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const at = new Date(`${value}T12:00:00.000Z`)
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value ? value : null
}

const clockTime = (value: string): { hour: number; minute: number } | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour < 24 && minute < 60 ? { hour, minute } : null
}

/**
 * What a new event needs before it is created (Jason, 2026-11-11): a name, the day, and — unless
 * it lasts all day — the time it starts. The calendar is asked only when the school has more than
 * one; the school follows from it. Everything else (the end, the place, repeats, notes) is on the
 * next screen, where autosave covers it.
 *
 * The day and time are the district's, whatever the browser's time zone.
 */
export const checkNewEvent = (input: NewEventInput): NewEventCheck => {
  const errors: Partial<Record<'title' | 'date' | 'time' | 'calendar', string>> = {}
  const title = checkTitle(input.title, 'Give the event a name.')
  if (title.error) errors.title = title.error

  const date = realDate(input.date)
  if (date === null) errors.date = 'Choose the day it happens.'

  const rawTime = typeof input.time === 'string' ? input.time.trim() : ''
  const time = rawTime === '' ? null : clockTime(rawTime)
  if (rawTime !== '' && time === null) errors.time = 'Enter a time, like 6:30 PM.'

  let calendar: CalendarChoice | undefined
  if (input.calendars.length === 0) errors.calendar = NO_CALENDAR
  else if (
    input.calendars.length === 1 &&
    (input.calendar === undefined || input.calendar === '')
  ) {
    calendar = input.calendars[0]
  } else {
    calendar = input.calendars.find((c) => String(c.id) === String(input.calendar))
    if (!calendar) errors.calendar = 'Choose which calendar this goes on.'
  }

  if (Object.keys(errors).length > 0 || !calendar || date === null) return { ok: false, errors }
  return {
    ok: true,
    title: title.title,
    start: zonedTime(date, time?.hour ?? 0, time?.minute ?? 0, DISTRICT_TIME_ZONE),
    allDay: time === null,
    calendar: calendar.id,
    school: calendar.tenant,
  }
}

const EVENT_NOT_ALLOWED =
  'Your account cannot add events for this school. Ask the district web team for help.'
const EVENT_GENERIC = 'The event could not be created. Please try again in a moment.'

/** A refused event create, explained. */
export const explainEventCreateError = (body: unknown): string => {
  const errors = (body as { errors?: unknown } | null)?.errors
  if (!Array.isArray(errors)) return EVENT_GENERIC
  for (const error of errors as { message?: unknown }[]) {
    if (typeof error?.message === 'string' && /not allowed/i.test(error.message)) {
      return EVENT_NOT_ALLOWED
    }
  }
  return EVENT_GENERIC
}

/** Where a submission opens: its own form. */
export const schoolEditPath = (
  collection: 'pages' | 'posts' | 'events',
  id: number | string,
): string => `/admin/collections/${collection}/${String(id)}`

/** The plain status beside a submission on the landing view, or null when nothing is pending. */
export const submissionStatus = (reviewState: unknown): string | null => {
  if (reviewState === 'submitted') return 'Sent for approval'
  if (reviewState === 'changes-requested') return 'Needs changes'
  // Approved with a Start still to come (Jason, 2026-11-04).
  if (reviewState === 'scheduled') return 'Approved, goes live later'
  return null
}
