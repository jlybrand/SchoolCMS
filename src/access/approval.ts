import { isDistrictAdmin } from './predicates'
import type { AuthUser } from './types'

/**
 * Approve the version the reviewer SAW, or nothing (`04` §4.1–4.2).
 *
 * A school's save on a queued page keeps it queued, so the content can change after the
 * district opened the queue. The queue sends back a token for what it rendered; approve
 * succeeds only while that is still the latest version, and then publishes exactly that
 * content (`src/collections/endpoints/approve-page.ts`).
 *
 * The token is the version id AND its `updatedAt`. Payload's autosave rewrites the latest
 * autosave version in place — same id, new content — so the id alone would pass a changed page.
 *
 * Pure. The endpoint gathers `reviewState` and `latest`; this decides.
 */

export type VersionToken = { versionId: string; updatedAt: string }

export type ApprovalInput = {
  user: AuthUser | null | undefined
  /** The page's review state, read from its latest draft. */
  reviewState: unknown
  /** What the reviewer saw, as the queue sent it back. */
  seen: VersionToken | null | undefined
  /** The latest stored version now, or null if there is none. */
  latest: VersionToken | null | undefined
}

export type ApprovalRefusal = 'forbidden' | 'not-waiting' | 'changed'

export type ApprovalResult = { ok: true } | { ok: false; reason: ApprovalRefusal }

const instant = (value: unknown): number | null => {
  if (typeof value !== 'string' || value === '') return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

const sameVersion = (a: VersionToken | null | undefined, b: VersionToken | null | undefined) => {
  if (!a || !b) return false
  const idA = a.versionId === undefined || a.versionId === null ? '' : String(a.versionId)
  const idB = b.versionId === undefined || b.versionId === null ? '' : String(b.versionId)
  if (idA === '' || idA !== idB) return false
  const timeA = instant(a.updatedAt)
  return timeA !== null && timeA === instant(b.updatedAt)
}

/**
 * Role first, so a school manager learns nothing about a page's state from the refusal.
 * Anything missing or unreadable is "changed": the safe failure is to show the reviewer the
 * page again, never to publish it unseen.
 */
export const checkApproval = ({
  user,
  reviewState,
  seen,
  latest,
}: ApprovalInput): ApprovalResult => {
  if (!isDistrictAdmin(user)) return { ok: false, reason: 'forbidden' }
  if (reviewState !== 'submitted') return { ok: false, reason: 'not-waiting' }
  if (!sameVersion(seen, latest)) return { ok: false, reason: 'changed' }
  return { ok: true }
}
