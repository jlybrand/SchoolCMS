import type { Endpoint, Payload, PayloadRequest } from 'payload'

import { checkApproval, type ApprovalRefusal, type VersionToken } from '@/access/approval'
import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { checkPostDates, type PostDates, type PostDatesInput } from '@/lib/post-dates'

/**
 * `POST /api/pages/:id/approve` and `POST /api/posts/:id/approve` — the queue's one click
 * (`04` §4.2). One implementation for every collection that goes through review.
 *
 * Publishes the version the reviewer SAW: the request carries the token the queue rendered,
 * `checkApproval` refuses unless it is still the latest version, and the content published is
 * that version's own data — not "whatever the draft is now".
 *
 * The publish itself is an ordinary `payload.update` AS THE REVIEWER, so it passes through
 * the same gates as any other: the collection's update access, `publishGate` (district only),
 * `applyReviewState` (clears the review fields), and the collection's after-change hooks. This endpoint adds
 * the version check and nothing that could widen what a publish may do.
 *
 * A narrow window remains between the check and the write. An autosave landing inside it would
 * be published over, not published: what goes live is still the version that was read, and the
 * later edit stays in the version history. Closing it fully needs a row lock Payload's adapter
 * does not expose.
 */

export type ApproveResult = { ok: true } | { ok: false; reason: ApprovalRefusal | 'not-found' }

/** The collections that go through review (`04` §4.1). */
export type ReviewedCollection = 'pages' | 'posts'

type LatestVersion = { token: VersionToken; version: Record<string, unknown> }

/** The latest stored version of a document — what the queue renders and what approve compares. */
export const latestVersion = async (
  payload: Payload,
  collection: ReviewedCollection,
  id: number | string,
  req?: PayloadRequest,
): Promise<LatestVersion | null> => {
  const { docs } = await payload.findVersions({
    collection,
    where: { parent: { equals: id } },
    sort: '-updatedAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
    ...(req ? { req } : {}),
  })
  const found = docs[0] as { id: unknown; updatedAt: unknown; version: unknown } | undefined
  if (!found || typeof found.updatedAt !== 'string') return null
  return {
    token: { versionId: String(found.id), updatedAt: found.updatedAt },
    version: (found.version ?? {}) as Record<string, unknown>,
  }
}

export const latestVersionToken = async (
  payload: Payload,
  collection: ReviewedCollection,
  id: number | string,
): Promise<VersionToken | null> => (await latestVersion(payload, collection, id))?.token ?? null

/** A version's content, without the fields Payload owns. */
export const publishable = (version: Record<string, unknown>): Record<string, unknown> => {
  const { id: _id, createdAt: _c, updatedAt: _u, _status: _s, ...content } = version
  return content
}

export const approveDocument = async (
  req: PayloadRequest,
  collection: ReviewedCollection,
  id: number | string,
  seen: VersionToken | null | undefined,
  /**
   * An announcement's dates, set as it is approved (Jason, 2026-11-04) — already checked
   * (`checkPostDates`). A future Start SCHEDULES instead of publishing: the approved version is
   * saved as a draft marked `scheduled`, so anything already live stays live until its time.
   */
  dates?: { dates: PostDates; schedules: boolean },
): Promise<ApproveResult> => {
  const user = req.user as AuthUser | null
  // Before any read, so a refusal reveals nothing about the page.
  if (!isDistrictAdmin(user)) return { ok: false, reason: 'forbidden' }

  const latest = await latestVersion(req.payload, collection, id, req)
  if (!latest) return { ok: false, reason: 'not-found' }

  const check = checkApproval({
    user,
    reviewState: latest.version.reviewState,
    seen,
    latest: latest.token,
  })
  if (!check.ok) return check

  const content = { ...publishable(latest.version), ...(dates?.dates ?? {}) }
  if (dates?.schedules) {
    await req.payload.update({
      collection,
      id,
      data: { ...content, _status: 'draft', reviewState: 'scheduled' } as never,
      draft: true,
      req,
      overrideAccess: false,
    })
    return { ok: true }
  }

  await req.payload.update({
    collection,
    id,
    data: { ...content, _status: 'published' },
    draft: false,
    req,
    overrideAccess: false,
  })
  return { ok: true }
}

/** Plain words for each refusal; the queue shows these as they are. */
type Refusal = Exclude<ApproveResult, { ok: true }>['reason']

export const APPROVE_MESSAGES: Record<Refusal, string> = {
  forbidden: 'Only district staff can approve changes.',
  'not-waiting':
    'This is no longer waiting for approval. Someone may have approved it or sent it back already.',
  changed:
    'This was changed after you opened it. Reload to see the latest version before approving.',
  'not-found': 'This no longer exists.',
}

const STATUS: Record<Refusal, number> = {
  forbidden: 403,
  'not-waiting': 409,
  changed: 409,
  'not-found': 404,
}

const tokenFrom = (body: unknown): VersionToken | null => {
  const { versionId, updatedAt } = (body ?? {}) as { versionId?: unknown; updatedAt?: unknown }
  return typeof versionId === 'string' && typeof updatedAt === 'string'
    ? { versionId, updatedAt }
    : null
}

export const makeApproveEndpoint = (collection: ReviewedCollection): Endpoint => ({
  path: '/:id/approve',
  method: 'post',
  handler: async (req) => {
    const id = req.routeParams?.id
    if (typeof id !== 'string' && typeof id !== 'number') {
      return Response.json({ error: APPROVE_MESSAGES['not-found'] }, { status: 404 })
    }
    const body: unknown = await req.json?.().catch(() => null)
    // Posts may carry dates (Jason, 2026-11-04); refused in words before anything is written.
    let dates: { dates: PostDates; schedules: boolean } | undefined
    if (collection === 'posts') {
      const check = checkPostDates((body ?? {}) as PostDatesInput, new Date())
      if (!check.ok) {
        return Response.json(
          { error: Object.values(check.errors)[0], errors: check.errors, reason: 'dates' },
          { status: 400 },
        )
      }
      dates = check
    }
    const result = await approveDocument(req, collection, id, tokenFrom(body), dates)
    if (result.ok) return Response.json({ ok: true })
    return Response.json(
      { error: APPROVE_MESSAGES[result.reason], reason: result.reason },
      { status: STATUS[result.reason] },
    )
  },
})
