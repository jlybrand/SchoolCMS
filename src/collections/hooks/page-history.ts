import {
  APIError,
  Forbidden,
  type CollectionBeforeOperationHook,
  type PayloadRequest,
} from 'payload'

import { canUsePageHistory } from '@/access/pages'
import type { AuthUser } from '@/access/types'

/**
 * Restoring a past version of a page is the district's (Jason, 2026-10-27).
 *
 * Payload's `restoreVersion` checks the collection's UPDATE access, and a school manager holds
 * that for their own school's pages — so access functions alone would let them bring back any
 * past version as a draft. This refuses the operation itself, on every route that reaches it
 * (REST `POST /api/pages/versions/:id`, GraphQL, the admin's Restore button).
 *
 * A restore that would PUBLISH is also refused by the publish gate; this covers the draft one.
 * The other half is `pagesReadVersionsAccess`: a school manager cannot list versions either.
 *
 * ONLY A VERSION THAT WAS PUBLISHED can be restored (Jason, 2026-10-27) — for the district too.
 * A draft that never went live was never approved, so restoring it would bring back words no
 * reviewer passed. The refusal is an `APIError` with its reason, so the admin's toast says why
 * rather than just "not allowed".
 *
 * `overrideAccess` is trusted server code — the Local API defaults to it — and passes.
 */

export const ONLY_PUBLISHED_RESTORES = 'Only a version that was published can be restored.'

const wasPublished = async (req: PayloadRequest, id: unknown): Promise<boolean> => {
  try {
    const version = await req.payload.findVersionByID({
      collection: 'pages',
      id: String(id),
      depth: 0,
      overrideAccess: true,
      req,
    })
    return (version?.version as { _status?: unknown } | undefined)?._status === 'published'
  } catch {
    return false
  }
}
export const restoreIsDistrictOnly: CollectionBeforeOperationHook = async ({
  args,
  operation,
  overrideAccess,
}) => {
  if (operation !== 'restoreVersion') return args
  /**
   * Whether this restore lands as a draft. Payload sets the status from it only AFTER the hooks
   * run, so without this `applyReviewState` sees the restored version's own `published` and
   * takes a draft restore for a publish (`src/collections/hooks/review-state.ts`).
   */
  if (args.req?.context) args.req.context.restoreAsDraft = args.draft === true
  if (overrideAccess) return args
  const user = (args?.req?.user as AuthUser | null | undefined) ?? null
  if (!canUsePageHistory(user)) throw new Forbidden()
  if (!(await wasPublished(args.req, args.id))) throw new APIError(ONLY_PUBLISHED_RESTORES, 403)
  return args
}
