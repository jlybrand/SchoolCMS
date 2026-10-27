import { Forbidden, type CollectionBeforeOperationHook } from 'payload'

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
 * `overrideAccess` is trusted server code — the Local API defaults to it — and passes.
 */
export const restoreIsDistrictOnly: CollectionBeforeOperationHook = async ({
  args,
  operation,
  overrideAccess,
}) => {
  if (operation !== 'restoreVersion' || overrideAccess) return args
  const user = (args?.req?.user as AuthUser | null | undefined) ?? null
  if (!canUsePageHistory(user)) throw new Forbidden()
  return args
}
