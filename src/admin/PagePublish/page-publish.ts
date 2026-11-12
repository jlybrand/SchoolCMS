/**
 * A page's Start as a choice made when publishing (Jason, 2026-11-11), in place of a Start field
 * in Page settings: ONE Publish button whose dialog asks "now or later" — on a page not yet on
 * the site, and on a change to one that is (2026-11-12). PURE — the control is
 * `PagePublishControl.tsx`.
 *
 * Scheduling is a DRAFT save marked `scheduled` with the Start (`scheduleFor`). A draft save never
 * touches the page on the site, so a live page stays exactly as it is until the schedule job
 * (`src/collections/endpoints/schedule.ts`) publishes the newest scheduled version at its time;
 * the district's own later edits join it, a school's drops it (`src/access/review-state.ts`).
 */

export type PublishState = {
  /** The page is on the site now. */
  live: boolean
  /** A publish — of the page, or of a change to it — is waiting for its time. */
  scheduled: boolean
}

export const publishStateFor = ({
  live,
  reviewState,
}: {
  live: boolean
  reviewState: unknown
}): PublishState => ({ live, scheduled: reviewState === 'scheduled' })

/** The dialog's choice: publish at once, or at a time picked in it. */
export type PublishWhen = 'now' | 'later'

/** The header's one button. `time` is the scheduled time, already formatted for the reader. */
export const headerLabel = (state: PublishState, time: string | null): string => {
  if (state.scheduled && time) {
    return state.live ? `Changes scheduled for ${time}` : `Scheduled for ${time}`
  }
  return state.live ? 'Publish changes' : 'Publish'
}

/** Opens on "Now"; on "Later", showing its time, when something is already scheduled. */
export const initialWhen = (state: PublishState): PublishWhen => (state.scheduled ? 'later' : 'now')

export const dialogHeading = (state: PublishState): string => {
  if (state.scheduled) {
    return state.live ? 'Change when your changes go live' : 'Change when this page goes live'
  }
  return state.live ? 'Publish your changes' : 'Publish this page'
}

/** What "later" means for this page: off the site until then, or the site as it is. */
export const laterHint = (state: PublishState): string =>
  state.live
    ? 'The page on the site stays as it is until then. Your changes go live on their own at that time.'
    : 'It stays off the site until then, and goes live on its own at that time.'

/** The dialog has one primary action, named for the choice made. */
export const primaryLabel = (state: PublishState, when: PublishWhen): string => {
  if (when === 'now') return 'Publish now'
  return state.scheduled ? 'Save the new time' : 'Schedule'
}

/** Clears any Start too: a stored one would otherwise turn "now" into a schedule. */
export const PUBLISH_NOW = { _status: 'published', publishAt: null } as const

/**
 * A draft save, not a publish with a Start: the server turns a publish with a future Start into a
 * draft only when nothing is live, and refuses it on a live page (`scheduled-dates.ts`). A draft
 * save asking for `scheduled` does the same for both, and leaves a live page up.
 */
export const scheduleFor = (iso: string) =>
  ({ _status: 'draft', publishAt: iso, reviewState: 'scheduled' }) as const

/** Asked for explicitly (`reviewState: null`) — see `resolveReview`'s cancel. */
export const CANCEL_SCHEDULE = { _status: 'draft', publishAt: null, reviewState: null } as const

/**
 * What the primary action sends — and whether as a draft save — or why it cannot. "Now" ignores
 * whatever the time box holds.
 */
export const publishRequest = (
  when: PublishWhen,
  value: string,
  now: Date,
):
  | {
      ok: true
      overrides: typeof PUBLISH_NOW | ReturnType<typeof scheduleFor>
      draft: boolean
    }
  | { ok: false; refusal: string } => {
  if (when === 'now') return { ok: true, overrides: PUBLISH_NOW, draft: false }
  const refusal = scheduleRefusal(value, now)
  if (refusal) return { ok: false, refusal }
  return { ok: true, overrides: scheduleFor(new Date(value).toISOString()), draft: true }
}

/** Why a typed day and time cannot be scheduled, or null. Same words as the announcement dates. */
export const scheduleRefusal = (value: string, now: Date): string | null => {
  const at = new Date(value)
  if (value.trim() === '' || Number.isNaN(at.getTime())) return 'Choose a day and time.'
  if (at.getTime() <= now.getTime()) return 'Choose a time in the future.'
  return null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** An ISO time as a `datetime-local` input's value, in the browser's own time zone. */
export const toLocalInputValue = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
