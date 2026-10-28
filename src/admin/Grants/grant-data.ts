import type { Payload, PayloadRequest } from 'payload'

import { GRANT_SCOPES } from '@/access/auto-approval'

import type { GrantHolder } from './grants'

/**
 * Users holding any known scope, read AS the viewer — the users collection's own access decides
 * what comes back. `grantRows` drops anything that is not a grant.
 */
export const findGrantHolders = async (
  payload: Payload,
  user: PayloadRequest['user'],
): Promise<GrantHolder[]> => {
  const { docs } = await payload.find({
    collection: 'users',
    where: { autoApprove: { in: GRANT_SCOPES.map((s) => s.value) } },
    depth: 0,
    pagination: false,
    user,
    overrideAccess: false,
  })
  return docs as GrantHolder[]
}

/** How far back the spot-check list reaches (`04` §4.3: "the last 30 days"). */
export const SPOT_CHECK_DAYS = 30

/**
 * Auto-approve entries from the last 30 days, read AS the viewer — the audit trail's own access
 * (district only) decides what comes back. Newest first; `autoApprovalRows` shapes them.
 */
export const findRecentAutoApprovals = async (
  payload: Payload,
  user: PayloadRequest['user'],
  now = new Date(),
) => {
  const since = new Date(now.getTime() - SPOT_CHECK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { docs } = await payload.find({
    collection: 'audit-events',
    where: {
      and: [{ autoApproved: { equals: true } }, { createdAt: { greater_than_equal: since } }],
    },
    sort: '-createdAt',
    limit: 100,
    depth: 0,
    user,
    overrideAccess: false,
  })
  return docs
}
