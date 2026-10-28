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
    label: 'Update a page',
    description: 'Change the words on a page of your school’s website.',
    href: '/admin/update-page',
  },
  {
    label: 'Add a page',
    description: 'Start a new page. The district places it on the site when they approve it.',
    href: '/admin/new-page',
  },
]

export type SchoolPageType = { value: string; label: string; description: string }

/**
 * The page types a school may create, with what each is for (`04` §2.4: "a short list with
 * plain-language descriptions"). The fixed types from `03` §2 — never `composed`, which is the
 * district's block layout and is refused for schools at three layers already.
 */
export const SCHOOL_PAGE_TYPES: readonly SchoolPageType[] = [
  {
    value: 'standard',
    label: 'General page',
    description: 'Words and links about one topic, like a club, a program or a school policy.',
  },
  {
    value: 'about',
    label: 'About the school',
    description: 'Who the school is: its mission, history, principal’s welcome and facts.',
  },
  {
    value: 'contact',
    label: 'Contact details',
    description: 'How to reach the school: address, phone numbers, office hours and directions.',
  },
  {
    value: 'staff',
    label: 'Staff list',
    description: 'A page that lists the people who work at the school and how to reach them.',
  },
  {
    value: 'calendar',
    label: 'Calendar',
    description: 'A page that shows the school’s upcoming dates and events.',
  },
  {
    value: 'documents',
    label: 'Forms and documents',
    description: 'A page that lists files families can download, like forms and handbooks.',
  },
]

/** Longer than this is not a heading; the slug and the menu label are both built from it. */
const MAX_TITLE = 120

type SchoolId = number | string

export type NewPageInput = {
  title?: unknown
  pageType?: unknown
  /** The schools the user is assigned to. */
  schools: readonly SchoolId[]
  /** The school chosen in the form, when there was a choice. */
  school?: unknown
}

export type NewPageCheck =
  | { ok: true; title: string; school: SchoolId }
  | { ok: false; errors: Partial<Record<'title' | 'pageType' | 'school', string>> }

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
  const errors: Partial<Record<'title' | 'pageType' | 'school', string>> = {}

  const title = checkTitle(input.title, 'Give the page a title.')
  if (title.error) errors.title = title.error

  if (!SCHOOL_PAGE_TYPES.some((t) => t.value === input.pageType)) {
    errors.pageType = 'Choose what kind of page this is.'
  }

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

/** Where a submission opens: its own form. */
export const schoolEditPath = (collection: 'pages' | 'posts', id: number | string): string =>
  `/admin/collections/${collection}/${String(id)}`

/** The plain status beside a submission on the landing view, or null when nothing is pending. */
export const submissionStatus = (reviewState: unknown): string | null => {
  if (reviewState === 'submitted') return 'Sent for approval'
  if (reviewState === 'changes-requested') return 'Needs changes'
  return null
}
