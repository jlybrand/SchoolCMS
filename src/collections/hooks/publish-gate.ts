import { Forbidden, type CollectionBeforeChangeHook } from 'payload'

import { canComposePages, canPublish } from '@/access/pages'
import type { AuthUser } from '@/access/types'
import { autoApprovalOf } from '@/collections/hooks/auto-approve'
import { scheduledRunOf } from '@/collections/hooks/post-dates'

/**
 * The hook half of two release-blocking gates (CLAUDE.md rules 3 and `03` §6.4 invariant 5).
 *
 * ============================================================================
 * A `school-manager` CANNOT PUBLISH BY ANY ROUTE — admin, REST, GraphQL, or
 * bulk operation. This file and `src/access/pages.ts` are both required.
 * ============================================================================
 *
 * WHY BOTH LAYERS. The access function judges the request: it sees the incoming `data` and
 * refuses early and cheaply. This hook runs after Payload merges that data over the stored
 * document, so it judges the RESULT of the write. That difference is not academic — a
 * partial update carrying only `{ title }` gives the access function no `pageType` and no
 * `_status` to look at, and a bulk operation's per-document shape is not what the caller
 * sent. Whatever the request looked like, a write that ends up published, or ends up
 * touching a composed page, passes through here.
 *
 * Neither layer is decoration. If you are tempted to delete one, the question to answer
 * first is which routes the other one cannot see.
 */

const userOf = (req: { user?: unknown }): AuthUser | null => (req?.user as AuthUser) ?? null

const instant = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null
  const at = new Date(value instanceof Date ? value : String(value))
  return Number.isNaN(at.getTime()) ? String(value) : at.toISOString()
}

/** Whether `incoming` is a Start that the stored document did not already have. */
const setsStart = (incoming: unknown, stored: unknown): boolean =>
  instant(incoming) !== null && instant(incoming) !== instant(stored)

/**
 * Blocks the draft -> published transition for anyone who may not publish.
 *
 * Judged on the INCOMING write rather than on a diff against the original, because both of
 * these must be refused:
 *   - draft -> published, the obvious transition
 *   - published -> published, a re-assert that changes nothing and would otherwise be a
 *     usable route ("it did not change the status")
 *
 * And this must be allowed: a school-manager editing a page that is already live. That
 * lands as a `draft`-status write against a published original — a new version awaiting
 * approval (`04` §5), not a publish.
 *
 * `publishAt` counts as publishing. It defers the transition rather than cancelling it, so
 * a gate that ignored it would let a school-manager publish by waiting.
 */
export const publishGate: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  const user = userOf(req)

  const assertsPublished = data?._status === 'published'
  /**
   * A Start this write SETS or CHANGES. Payload merges the stored document into every write, so a
   * school's save on something the district scheduled carries the stored Start unchanged — that
   * is an edit, not a school scheduling a publish, and it is allowed (it drops the approval;
   * `src/access/review-state.ts`). Any Start the write differs on still counts as publishing.
   */
  const schedulesPublish = setsStart(data?.publishAt, originalDoc?.publishAt)

  /**
   * The one exception: the auto-approval hook's own publish, under a district grant
   * (`src/collections/hooks/auto-approve.ts`). It is marked in `req.context`, which no request
   * can set; the same body sent by a person has no mark and is refused below.
   */
  if (assertsPublished && !schedulesPublish && autoApprovalOf(req)) return data

  /**
   * And the schedule job's own publish of a post the district approved for later
   * (`src/jobs/post-schedule.ts`) — marked the same way, by server code only. Its stored Start
   * has passed by then, which is why `schedulesPublish` does not stop it.
   */
  if (assertsPublished && scheduledRunOf(req) === 'publish') return data

  if ((assertsPublished || schedulesPublish) && !canPublish(user)) {
    throw new Forbidden()
  }

  return data
}

/**
 * Keeps `composed` pages and the block array district-only (`03` §2–3).
 *
 * Reads `pageType` from the write merged over the stored document, which is what catches
 * the partial update that edits a composed page without mentioning `pageType`. A `layout`
 * array in the payload is refused on its own terms too, whatever `pageType` claims —
 * blocks are district-only regardless of the page they arrive on.
 */
export const composedPagesAreDistrictOnly: CollectionBeforeChangeHook = ({
  data,
  originalDoc,
  req,
}) => {
  const user = userOf(req)
  if (canComposePages(user)) return data

  const resultingType = data?.pageType ?? originalDoc?.pageType
  const sendsBlocks = Array.isArray(data?.layout) && data.layout.length > 0

  if (resultingType === 'composed' || sendsBlocks) {
    throw new Forbidden()
  }

  return data
}
