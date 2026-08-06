import type { AuthUser, Role, TenantRef } from './types'

/**
 * Role and tenant-membership primitives (`03` §6.1).
 *
 * Every one of these DENIES on absent or malformed input. Deny by default is not a style
 * preference here — because tenant isolation is enforced in this layer rather than in the
 * database (`02` §4.2), a predicate that returns `true` on a malformed user is a tenant
 * leak, not a bug report.
 */

const rolesOf = (user: AuthUser | null | undefined): Role[] =>
  Array.isArray(user?.roles) ? user.roles : []

/** Exact match only — no case folding, no prefix matching, no substring matching. */
export const hasRole = (user: AuthUser | null | undefined, role: Role): boolean =>
  rolesOf(user).includes(role)

export const isDistrictAdmin = (user: AuthUser | null | undefined): boolean =>
  hasRole(user, 'district-admin')

export const isSchoolManager = (user: AuthUser | null | undefined): boolean =>
  hasRole(user, 'school-manager')

export const isSystemSync = (user: AuthUser | null | undefined): boolean =>
  hasRole(user, 'system-sync')

/**
 * Normalizes a tenant reference to a string id, or null if it is not usable.
 *
 * Ids are compared as strings throughout so a numeric id from Postgres and a string id from
 * a query parameter can never disagree — a mismatch here would read as "not your tenant"
 * (safe) or, worse, be defeated by `==` coercion elsewhere (not safe).
 */
export const tenantIdOf = (ref: TenantRef | null | undefined): string | null => {
  if (ref === null || ref === undefined) return null
  if (typeof ref === 'string') return ref === '' ? null : ref
  if (typeof ref === 'number') return String(ref)
  if (typeof ref === 'object' && 'id' in ref) {
    const { id } = ref
    if (id === null || id === undefined || id === '') return null
    return String(id)
  }
  return null
}

/** Tenant ids assigned to the user. Empty for district-admin — see `hasTenant`. */
export const tenantIdsFor = (user: AuthUser | null | undefined): string[] => {
  const rows = Array.isArray(user?.tenants) ? user.tenants : []
  const ids: string[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const id = tenantIdOf(row.tenant)
    if (id !== null) ids.push(id)
  }
  return ids
}

/**
 * Literal membership check. Deliberately does NOT special-case district-admin: cross-tenant
 * capability is granted explicitly in the access functions, so that reading one of those
 * functions tells you the whole rule.
 */
export const hasTenant = (
  user: AuthUser | null | undefined,
  tenant: TenantRef | null | undefined,
): boolean => {
  const target = tenantIdOf(tenant)
  if (target === null) return false
  return tenantIdsFor(user).includes(target)
}
