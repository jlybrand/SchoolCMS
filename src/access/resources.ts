import type { Access, Where } from 'payload'

import { isDistrictAdmin, isSystemSync, tenantIdOf, tenantIdsFor } from './predicates'
import type { AuthUser } from './types'

/**
 * The Resources library (Jason, 2026-11-13): one library of each site's files — images and
 * documents — in folders. `resources` and `resource-folders` share these rules.
 *
 * - The PUBLIC reads every file: they are the website's. There is no staff-only setting until
 *   Entra sign-in reaches every staff member (Jason) — then `visibility` joins this constraint.
 * - A SCHOOL MANAGER reads, uploads, changes and removes their OWN school's, with NO APPROVAL
 *   (Jason): a file is not on the site until an approved page or announcement uses it. The
 *   activity log records it all.
 * - The DISTRICT works across every site. The sync has no business here.
 *
 * Reads return query constraints, never booleans, for anyone scoped (CLAUDE.md rule 2).
 */

const userOf = (req: { user?: unknown }): AuthUser | null => (req?.user as AuthUser) ?? null

/** Every file has a site; this is "all of them", written as the constraint rule 2 asks for. */
export const PUBLIC_RESOURCE_CONSTRAINT: Where = { tenant: { exists: true } }

const ownSchools = (user: AuthUser): boolean | Where => {
  if (isDistrictAdmin(user)) return true
  if (isSystemSync(user)) return false
  const tenantIds = tenantIdsFor(user)
  return tenantIds.length === 0 ? false : { tenant: { in: tenantIds } }
}

export const resourcesReadAccess: Access = ({ req }) => {
  const user = userOf(req)
  return user ? ownSchools(user) : PUBLIC_RESOURCE_CONSTRAINT
}

/** Upload: the district anywhere; a school manager into their own school only. */
export const resourcesCreateAccess: Access = ({ req, data }) => {
  const user = userOf(req)
  if (!user || isSystemSync(user)) return false
  if (isDistrictAdmin(user)) return true
  const allowed = tenantIdsFor(user)
  const target = tenantIdOf((data as { tenant?: unknown } | undefined)?.tenant as never)
  return target !== null && allowed.includes(target)
}

/** Change or remove: own school's only, as a constraint. */
export const resourcesWriteAccess: Access = ({ req }) => {
  const user = userOf(req)
  return user ? ownSchools(user) : false
}
