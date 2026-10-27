import { Forbidden, ValidationError, type CollectionBeforeChangeHook } from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { resolveReview, type ReviewFields, type ReviewState } from '@/access/review-state'
import type { AuthUser } from '@/access/types'

/**
 * Applies the review-state machine to a `pages` write (`04` §4.1).
 *
 * The transitions are decided in `src/access/review-state.ts`, which is pure; this is the
 * adapter. It runs AFTER `publishGate`, so a school manager's publishing write has already
 * been refused by the time it gets here — what it is told about publishing is only ever a
 * district admin's approve.
 *
 * THE HOOK OWNS ALL FOUR FIELDS. Whatever the request sent for `reviewNote`, `submittedAt`
 * and `submittedBy` is replaced by the resolved value, so none of them needs field-level
 * access to be unforgeable. `reviewState` is read as a request ("send this for approval"),
 * never stored as sent.
 *
 * Only a missing note is a ValidationError: it is the one refusal the person fixes in the
 * form. Every other refusal is a permission, and reads as one.
 */

const userOf = (req: { user?: unknown }): AuthUser | null => (req?.user as AuthUser) ?? null

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const storedFields = (doc: Record<string, unknown> | undefined): ReviewFields | null => {
  if (!doc) return null
  return {
    reviewState: (doc.reviewState as ReviewState | null | undefined) ?? null,
    reviewNote: str(doc.reviewNote),
    submittedAt: str(doc.submittedAt),
    submittedBy: relationshipIdOf(doc.submittedBy as never),
  }
}

/**
 * The submitter as the database stores it. `resolveReview` compares ids as strings (the
 * project's rule, `src/access/predicates.ts`); Postgres wants the users' serial id back. The
 * resolved id is only ever the writing user's or the stored one, so it maps to one of those.
 */
const storableSubmitter = (
  resolved: string | null,
  user: AuthUser | null,
  doc: Record<string, unknown> | undefined,
): unknown => {
  if (resolved === null) return null
  if (user && String(user.id) === resolved) return user.id
  const stored = doc?.submittedBy
  return typeof stored === 'object' && stored !== null && 'id' in stored
    ? (stored as { id: unknown }).id
    : stored
}

export const applyReviewState: CollectionBeforeChangeHook = ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  /**
   * A RESTORE brings back an old version's content, review fields included. Those fields are
   * history, not a request: read as one, a district admin restoring a version a school saved
   * would be "asking for editing", which the machine refuses. So a restore asks for nothing,
   * and the page keeps the review state it has now. (Only the district can restore at all —
   * `src/collections/hooks/page-history.ts`.)
   */
  const restoring = req.context?.isRestoringVersion === true
  /**
   * A restore carries the restored version's `_status`; it publishes only when it is not
   * restored as a draft (`restoreAsDraft`, set by `restoreIsDistrictOnly`).
   */
  const publishing =
    data?._status === 'published' && !(restoring && req.context?.restoreAsDraft === true)

  const result = resolveReview({
    user: userOf(req),
    current: operation === 'create' ? null : storedFields(originalDoc),
    requested: restoring ? undefined : (data?.reviewState as ReviewState | null | undefined),
    note: restoring ? undefined : (data?.reviewNote as string | null | undefined),
    publishing,
    now: new Date().toISOString(),
  })

  if (!result.ok) {
    if (result.field === 'reviewNote') {
      throw new ValidationError({ errors: [{ path: 'reviewNote', message: result.reason }] })
    }
    throw new Forbidden()
  }

  return {
    ...data,
    ...result.fields,
    submittedBy: storableSubmitter(result.fields.submittedBy, userOf(req), originalDoc),
  }
}
