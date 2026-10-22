import { isDistrictAdmin, isSchoolManager } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

/**
 * The two decisions under the school plane's "Send for approval" control (`04` §2.3), kept
 * pure so they are test-first; the components in this directory only render them.
 */

/**
 * Whether this user gets the one button in place of Payload's draft and publish controls.
 *
 * Decided by role, not by Payload's `hasPublishPermission`: a district admin whose access
 * happens to refuse one publish should see why, not be quietly turned into a submitter. A user
 * holding district-admin as well keeps the publisher's controls — roles are flat (`03` §6.1),
 * and the publish gate is what actually decides, on every route.
 */
export const sendsForApproval = (user: AuthUser | null | undefined): boolean =>
  isSchoolManager(user) && !isDistrictAdmin(user)

export type ReviewStatus = {
  /** `idle` nothing pending, `waiting` in the queue, `action` the school has something to do. */
  tone: 'idle' | 'waiting' | 'action'
  heading: string
  detail: string
  /** The reviewer's note — present only on changes requested, and only when non-empty. */
  note?: string
}

export type ReviewStatusInput = {
  reviewState?: unknown
  reviewNote?: unknown
  submittedAt?: unknown
}

const sentOn = (submittedAt: unknown, timeZone: string): string | null => {
  if (typeof submittedAt !== 'string') return null
  const date = new Date(submittedAt)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone }).format(date)
}

/**
 * The status line a school manager sees in place of "Draft" / "Published".
 *
 * `04` §2.1 rules out draft-versus-published as a visible concept, so this speaks only of
 * what the school did and what happens next. `editing` and nothing-pending read the same:
 * the difference matters to the queue, not to the person typing. A stored value outside the
 * three reads as nothing pending, as it does in `resolveReview`.
 *
 * `timeZone` is a parameter so the date is the district's day, not the server's or the
 * test runner's.
 */
export const describeReview = (input: ReviewStatusInput, timeZone: string): ReviewStatus => {
  if (input.reviewState === 'submitted') {
    const day = sentOn(input.submittedAt, timeZone)
    return {
      tone: 'waiting',
      heading: day ? `Sent for approval on ${day}` : 'Sent for approval',
      detail: 'The district will review it before it goes live.',
    }
  }

  if (input.reviewState === 'changes-requested') {
    const note = typeof input.reviewNote === 'string' ? input.reviewNote.trim() : ''
    return {
      tone: 'action',
      heading: 'The district asked for changes',
      detail: 'Make the changes, then send it for approval again.',
      ...(note ? { note } : {}),
    }
  }

  return {
    tone: 'idle',
    heading: 'Your changes save automatically',
    detail: 'When you are ready, send them for approval.',
  }
}
