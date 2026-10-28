import type { CollectionAfterChangeHook, PayloadRequest } from 'payload'

import {
  changedFields,
  decideAutoApproval,
  NEW_POST_BASELINE,
  POST_JUDGED_FIELDS,
  applicableScopes,
} from '@/access/auto-approval'
import type { AuthUser } from '@/access/types'

/**
 * Publishes an announcement on its sender's behalf when a district grant covers it (`04` §4.3;
 * `posts.routine`, Jason 2026-10-28). THE FIRST AUTO-APPROVAL THAT ACTS.
 *
 * When a school manager SENDS an announcement (`reviewState` → `submitted`) and holds a scope
 * the posts rules define, this compares what they sent against the live announcement — or, for
 * one never published, against what a new one starts as — and asks `decideAutoApproval`. Yes:
 * it publishes that version, IN THE SAME TRANSACTION as the send. No: nothing happens, and it
 * waits in the queue like any other.
 *
 * THE MARK. The publish runs with `req.context.autoApproval = { scope }`. `publishGate` and
 * `applyReviewState` let a school manager's publish through ONLY with it; the audit records it as
 * `auto-approve`, flagged, by the sender, naming the grant; the outcome email is not sent.
 * `req.context` is filled by server code only — no REST, GraphQL or admin request can set it —
 * and this hook removes it once its publish is done.
 *
 * Registered LAST in `afterChange`: the send's own audit entry (`submit`) is written first, so the
 * trail reads submit, then auto-approve.
 */

export const AUTO_APPROVAL = 'autoApproval'

export type AutoApprovalMark = { scope: string }

/** The mark this hook puts on its own publish, or null. */
export const autoApprovalOf = (req: Pick<PayloadRequest, 'context'>): AutoApprovalMark | null => {
  const mark = req.context?.[AUTO_APPROVAL] as AutoApprovalMark | undefined
  return mark && typeof mark.scope === 'string' ? mark : null
}

/** A version's content, without the fields Payload owns (as the approve endpoint does). */
const publishable = (doc: Record<string, unknown>): Record<string, unknown> => {
  const { id: _id, createdAt: _c, updatedAt: _u, _status: _s, ...content } = doc
  return content
}

export const autoApprovePost: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  // Our own publish coming back through the hooks.
  if (autoApprovalOf(req)) return doc

  const sent = doc.reviewState === 'submitted' && previousDoc?.reviewState !== 'submitted'
  if (!sent) return doc

  const user = req.user as AuthUser | null
  // Cheap exit for everyone without a posts grant — which, at launch, is everyone (`04` §4.3).
  if (applicableScopes(user, 'posts').length === 0) return doc

  const live = await req.payload.findByID({
    collection: 'posts',
    id: doc.id,
    draft: false,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
    req,
  })
  const isLive = (live as { _status?: unknown } | null)?._status === 'published'

  const decision = decideAutoApproval({
    user,
    change: {
      collection: 'posts',
      isCreate: !isLive,
      changedFields: changedFields(
        isLive ? (live as unknown as Record<string, unknown>) : NEW_POST_BASELINE,
        doc,
        POST_JUDGED_FIELDS,
        NEW_POST_BASELINE,
      ),
      requiresTranslationReview: doc.requiresTranslationReview === true,
    },
  })
  if (!decision.approve) return doc

  req.context[AUTO_APPROVAL] = { scope: decision.scope } satisfies AutoApprovalMark
  try {
    return await req.payload.update({
      collection: 'posts',
      id: doc.id,
      data: { ...publishable(doc), _status: 'published' },
      draft: false,
      // Trusted server code acting on a district grant; the gates read the mark, not access.
      overrideAccess: true,
      req,
    })
  } finally {
    delete req.context[AUTO_APPROVAL]
  }
}
