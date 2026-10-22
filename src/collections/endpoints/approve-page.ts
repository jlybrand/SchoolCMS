import type { Endpoint, Payload, PayloadRequest } from 'payload'

import { checkApproval, type ApprovalRefusal, type VersionToken } from '@/access/approval'
import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

/**
 * `POST /api/pages/:id/approve` — the queue's one click (`04` §4.2).
 *
 * Publishes the version the reviewer SAW: the request carries the token the queue rendered,
 * `checkApproval` refuses unless it is still the latest version, and the content published is
 * that version's own data — not "whatever the draft is now".
 *
 * The publish itself is an ordinary `payload.update` AS THE REVIEWER, so it passes through
 * the same gates as any other: `pagesUpdateAccess`, `publishGate` (district only),
 * `applyReviewState` (clears the review fields), and `revalidateOnPublish`. This endpoint adds
 * the version check and nothing that could widen what a publish may do.
 *
 * A narrow window remains between the check and the write. An autosave landing inside it would
 * be published over, not published: what goes live is still the version that was read, and the
 * later edit stays in the version history. Closing it fully needs a row lock Payload's adapter
 * does not expose.
 */

export type ApproveResult = { ok: true } | { ok: false; reason: ApprovalRefusal | 'not-found' }

type LatestVersion = { token: VersionToken; version: Record<string, unknown> }

/** The latest stored version of a page — what the queue renders and what approve compares. */
export const latestVersion = async (
  payload: Payload,
  id: number | string,
  req?: PayloadRequest,
): Promise<LatestVersion | null> => {
  const { docs } = await payload.findVersions({
    collection: 'pages',
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
  id: number | string,
): Promise<VersionToken | null> => (await latestVersion(payload, id))?.token ?? null

/** A version's content, without the fields Payload owns. */
const publishable = (version: Record<string, unknown>): Record<string, unknown> => {
  const { id: _id, createdAt: _c, updatedAt: _u, _status: _s, ...content } = version
  return content
}

export const approvePage = async (
  req: PayloadRequest,
  id: number | string,
  seen: VersionToken | null | undefined,
): Promise<ApproveResult> => {
  const user = req.user as AuthUser | null
  // Before any read, so a refusal reveals nothing about the page.
  if (!isDistrictAdmin(user)) return { ok: false, reason: 'forbidden' }

  const latest = await latestVersion(req.payload, id, req)
  if (!latest) return { ok: false, reason: 'not-found' }

  const check = checkApproval({
    user,
    reviewState: latest.version.reviewState,
    seen,
    latest: latest.token,
  })
  if (!check.ok) return check

  await req.payload.update({
    collection: 'pages',
    id,
    data: { ...publishable(latest.version), _status: 'published' },
    draft: false,
    req,
    overrideAccess: false,
  })
  return { ok: true }
}

/** Plain words for each refusal; the queue shows these as they are. */
type Refusal = Exclude<ApproveResult, { ok: true }>['reason']

export const APPROVE_MESSAGES: Record<Refusal, string> = {
  forbidden: 'Only district staff can approve pages.',
  'not-waiting':
    'This page is no longer waiting for approval. Someone may have approved it or sent it back already.',
  changed:
    'This page was changed after you opened it. Reload to see the latest version before approving.',
  'not-found': 'This page no longer exists.',
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

export const approvePageEndpoint: Endpoint = {
  path: '/:id/approve',
  method: 'post',
  handler: async (req) => {
    const id = req.routeParams?.id
    if (typeof id !== 'string' && typeof id !== 'number') {
      return Response.json({ error: APPROVE_MESSAGES['not-found'] }, { status: 404 })
    }
    const body: unknown = await req.json?.().catch(() => null)
    const result = await approvePage(req, id, tokenFrom(body))
    if (result.ok) return Response.json({ ok: true })
    return Response.json(
      { error: APPROVE_MESSAGES[result.reason], reason: result.reason },
      { status: STATUS[result.reason] },
    )
  },
}
