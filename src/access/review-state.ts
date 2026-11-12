import { isDistrictAdmin, isSchoolManager } from './predicates'
import type { AuthUser } from './types'

/**
 * The review-state machine (`04` §4.1).
 *
 * Built on Payload drafts and versions — there is no parallel change-request system
 * (`03` §7). A page's pending change IS its latest draft; these four fields say only where
 * that draft stands:
 *
 *   null                 nothing pending
 *   `editing`            a school manager has saved without sending
 *   `submitted`          in the district's queue
 *   `changes-requested`  sent back, with a note, still editable
 *   `scheduled`          approved with a future Start; goes live at its time (Jason,
 *                        2026-11-04). A school's save drops it: new words, unapproved. The
 *                        district cancels it by asking for `null` (2026-11-11).
 *
 * PURE, and the only place the transitions are decided. The `beforeChange` hook in
 * `src/collections/hooks/review-state.ts` applies the result and overwrites whatever the
 * request sent for these fields — so a school manager cannot forge a reviewer's note or a
 * submitter by writing them directly.
 *
 * WHAT THIS DOES NOT DECIDE: whether a write publishes. That is the publish gate's
 * (`src/collections/hooks/publish-gate.ts`), which runs first. This function is told whether
 * the write publishes and clears the review fields when a district admin's does — that is
 * what "approve" is.
 */

export type ReviewState = 'editing' | 'submitted' | 'changes-requested' | 'scheduled'

export const REVIEW_STATES: readonly ReviewState[] = [
  'editing',
  'submitted',
  'changes-requested',
  'scheduled',
] as const

export type ReviewFields = {
  reviewState: ReviewState | null
  /** The district's "what needs to change" — set only with `changes-requested`. */
  reviewNote: string | null
  /** When the pending change was FIRST sent. Drives age and escalation (`04` §5). */
  submittedAt: string | null
  /** Who sent it — who hears back (`04` §4.5). A user id. */
  submittedBy: string | null
}

export type ReviewInput = {
  user: AuthUser | null | undefined
  /** The stored fields, or null for a create. */
  current: ReviewFields | null
  /**
   * The `reviewState` the write asks for. `undefined` when it was not sent. Payload's admin
   * sends every field on save, so a value equal to the current one also means "not asked".
   */
  requested?: ReviewState | null | undefined
  /** The `reviewNote` the write sent. Read only from a district admin requesting changes. */
  note?: string | null | undefined
  /** Whether this write publishes — decided by the publish gate, not here. */
  publishing: boolean
  /** Whether this write carries a future Start (`checkPostDates`) — what `scheduled` needs. */
  schedules?: boolean
  /** ISO timestamp for `submittedAt`. Passed in so the function stays pure. */
  now: string
}

export type ReviewResult =
  { ok: true; fields: ReviewFields } | { ok: false; reason: string; field?: keyof ReviewFields }

const NOTHING_PENDING: ReviewFields = {
  reviewState: null,
  reviewNote: null,
  submittedAt: null,
  submittedBy: null,
}

/** Stored fields, with any state outside the three read as nothing pending. */
const normalize = (current: ReviewFields | null): ReviewFields => {
  if (!current) return NOTHING_PENDING
  const known = REVIEW_STATES.includes(current.reviewState as ReviewState)
  return known ? current : { ...current, reviewState: null }
}

const refuse = (reason: string, field?: keyof ReviewFields): ReviewResult => ({
  ok: false,
  reason,
  ...(field ? { field } : {}),
})

const forSchoolManager = (
  user: AuthUser,
  current: ReviewFields,
  input: ReviewInput,
): ReviewResult => {
  if (input.publishing) return refuse('School managers send changes for approval.')

  const asked = input.requested !== undefined && input.requested !== current.reviewState

  if (input.requested === 'submitted' && current.reviewState !== 'submitted') {
    return {
      ok: true,
      fields: {
        reviewState: 'submitted',
        // Answered by resubmitting; the versions keep the history.
        reviewNote: null,
        submittedAt: input.now,
        submittedBy: String(user.id),
      },
    }
  }

  if (asked && input.requested !== 'editing') {
    return refuse('Only the district can request changes or clear a review.', 'reviewState')
  }

  /**
   * A save that is not a send. A queued page stays queued and a sent-back page keeps its note
   * until resent. Payload merges the stored document into every write, so a save on a queued
   * page cannot be told apart from a resend — see `review-state.test.ts`.
   */
  if (current.reviewState === 'submitted' || current.reviewState === 'changes-requested') {
    return { ok: true, fields: current }
  }

  return { ok: true, fields: { ...NOTHING_PENDING, reviewState: 'editing' } }
}

const forDistrictAdmin = (current: ReviewFields, input: ReviewInput): ReviewResult => {
  if (input.publishing) return { ok: true, fields: NOTHING_PENDING }

  /**
   * Approve with a future Start (or schedule its own post): out of the queue until its time. The
   * submitter stays, so they hear now and again when it goes live. Not from `changes-requested`:
   * the school has not resent it, so there is nothing approved to schedule.
   */
  if (input.requested === 'scheduled') {
    if (input.schedules !== true)
      return refuse('Scheduling needs a time to go live.', 'reviewState')
    if (current.reviewState === 'changes-requested') {
      return refuse('This was sent back to the school. It needs resending first.', 'reviewState')
    }
    return { ok: true, fields: { ...current, reviewState: 'scheduled', reviewNote: null } }
  }

  const asked = input.requested !== undefined && input.requested !== current.reviewState
  if (!asked) return { ok: true, fields: current }

  /**
   * Cancel a schedule (Jason, 2026-11-11 — the Start is chosen when publishing, and unchosen
   * there). Asked for, never inferred from a Start that has passed. A school's approved change
   * goes back to the queue with its sender and age; the district's own has nothing pending.
   */
  if (input.requested === null && current.reviewState === 'scheduled') {
    return {
      ok: true,
      fields:
        current.submittedBy === null
          ? NOTHING_PENDING
          : { ...current, reviewState: 'submitted', reviewNote: null },
    }
  }

  if (input.requested !== 'changes-requested') {
    return refuse('The district publishes directly or requests changes.', 'reviewState')
  }

  if (current.reviewState !== 'submitted') {
    return refuse('Changes can only be requested on something sent for approval.', 'reviewState')
  }

  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (note === '') {
    return refuse('Say what needs to change. The school sees this note.', 'reviewNote')
  }

  return { ok: true, fields: { ...current, reviewState: 'changes-requested', reviewNote: note } }
}

/** Decides the review fields after a write, or refuses it. */
export const resolveReview = (input: ReviewInput): ReviewResult => {
  const current = normalize(input.current)

  /**
   * NO USER AT ALL means access was overridden — the seed, a script, the Phase 9 import. An
   * anonymous API request never gets here: the access functions refuse it first. Trusted
   * server code moves nothing through review and changes nothing about it.
   */
  if (!input.user) return { ok: true, fields: current }

  if (isDistrictAdmin(input.user)) return forDistrictAdmin(current, input)
  if (isSchoolManager(input.user)) return forSchoolManager(input.user, current, input)

  return refuse('Only signed-in staff move a page through review.')
}
