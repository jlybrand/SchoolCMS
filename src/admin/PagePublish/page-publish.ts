/**
 * A page's Start as a choice made when publishing (Jason, 2026-11-11): "Publish now" or
 * "Schedule for…", in place of a Start field in Page settings. PURE — the control is
 * `PagePublishControl.tsx`.
 *
 * The server already does the scheduling: publishing with a Start still to come is stored as a
 * draft marked `scheduled` (`src/collections/hooks/scheduled-dates.ts`), and the schedule job
 * puts it live at its time. So each choice is just what the write sends.
 */

export type PublishOffer =
  /** Not on the site: Publish now, or Schedule for… */
  | 'draft'
  /** Scheduled: its time, and Publish now, Change the time, Cancel the schedule. */
  | 'scheduled'
  /**
   * On the site: Payload's own "Publish changes". A live page cannot be scheduled — that would
   * take it down until its time (`scheduled-dates.ts` refuses it).
   */
  | 'live'

export const publishOfferFor = ({
  live,
  reviewState,
}: {
  live: boolean
  reviewState: unknown
}): PublishOffer => {
  if (reviewState === 'scheduled') return 'scheduled'
  return live ? 'live' : 'draft'
}

/** Clears any Start too: a stored one would otherwise turn "now" into a schedule. */
export const PUBLISH_NOW = { _status: 'published', publishAt: null } as const

export const scheduleFor = (iso: string) => ({ _status: 'published', publishAt: iso }) as const

/** Asked for explicitly (`reviewState: null`) — see `resolveReview`'s cancel. */
export const CANCEL_SCHEDULE = { _status: 'draft', publishAt: null, reviewState: null } as const

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
