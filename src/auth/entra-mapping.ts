import type { Role } from '@/access/types'

/**
 * Entra group → platform role mapping (`02` §7).
 *
 * Runs on every login. Roles and tenant assignments refresh from Entra group membership
 * each time, which is what makes **deprovisioning automatic**: when IT disables a district
 * account, platform access ends with it, rather than depending on someone remembering to
 * remove a local user.
 *
 * Configured from `ENTRA_GROUP_DISTRICT_ADMIN` / `ENTRA_GROUP_SCHOOL_MANAGER`.
 */
export type EntraGroupMap = Record<string, Role>

/**
 * Roles that a human login may NEVER be granted, regardless of directory configuration.
 *
 * `system-sync` is a non-human actor for the CSI staff sync, scoped to writing the staff
 * directory's CSI fields and nothing else (`11` §8). If someone
 * creates a matching group in Entra — by accident or otherwise — that must not become a
 * login path into a service identity.
 */
const NEVER_VIA_LOGIN: readonly Role[] = ['system-sync'] as const

/** Stable output order, so a role list never depends on directory claim ordering. */
const ROLE_ORDER: readonly Role[] = ['district-admin', 'school-manager', 'system-sync'] as const

/**
 * Maps Entra group claims to platform roles.
 *
 * **This is an allowlist.** An unrecognised group grants nothing and never falls through to
 * a default — a district directory holds hundreds of groups, and fall-through would make
 * every unrelated group addition a privilege grant. Matching is exact: no case folding, no
 * prefix matching.
 *
 * Absent, empty, or malformed claims yield no roles. A misconfigured deployment fails
 * closed.
 */
export const mapEntraGroupsToRoles = (
  groups: readonly unknown[] | null | undefined,
  groupMap: EntraGroupMap | null | undefined,
): Role[] => {
  if (!Array.isArray(groups) || !groupMap || typeof groupMap !== 'object') return []

  const granted = new Set<Role>()

  for (const group of groups) {
    if (typeof group !== 'string') continue
    const key = group.trim()
    if (key === '') continue

    const role = Object.prototype.hasOwnProperty.call(groupMap, key) ? groupMap[key] : undefined
    if (!role) continue
    if (NEVER_VIA_LOGIN.includes(role)) continue

    granted.add(role)
  }

  return ROLE_ORDER.filter((role) => granted.has(role))
}

/** Builds the group map from environment configuration (`.env.example`). */
export const groupMapFromEnv = (env: NodeJS.ProcessEnv = process.env): EntraGroupMap => {
  const map: EntraGroupMap = {}
  const districtAdmin = env.ENTRA_GROUP_DISTRICT_ADMIN?.trim()
  const schoolManager = env.ENTRA_GROUP_SCHOOL_MANAGER?.trim()

  if (districtAdmin) map[districtAdmin] = 'district-admin'
  if (schoolManager) map[schoolManager] = 'school-manager'

  return map
}
