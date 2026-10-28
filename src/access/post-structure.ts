import type { Access } from 'payload'

import { isDistrictAdmin, isSchoolManager, tenantIdsFor } from './predicates'
import type { AuthUser } from './types'

/**
 * Read access for the lists announcements are organised by (Jason, 2026-10-28): folders and
 * boards, one set per site, and the district-wide tag list. The district makes all three, so
 * writes are `districtOnly` (`src/access/tenant-scoped.ts`).
 *
 * The sync account is denied outright, as on every content collection (`11`). Anonymous callers
 * read none of them: the public site reaches them through `src/content/*`, not the API.
 */

const userOf = (req: { user?: unknown }): AuthUser | null => (req?.user as AuthUser) ?? null

/** Folders and boards: the district reads all; a school manager their own sites', as a constraint. */
export const schoolListReadAccess: Access = ({ req }) => {
  const user = userOf(req)
  if (isDistrictAdmin(user)) return true
  if (!isSchoolManager(user)) return false
  const tenantIds = tenantIdsFor(user)
  if (tenantIds.length === 0) return false
  return { tenant: { in: tenantIds } }
}

/** The tag list: one for the whole district, read by the staff who tick from it. */
export const staffReadAccess: Access = ({ req }) => {
  const user = userOf(req)
  return isDistrictAdmin(user) || isSchoolManager(user)
}
