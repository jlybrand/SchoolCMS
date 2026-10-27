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
