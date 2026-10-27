/**
 * Roles (`03` §6.1). Deliberately three, and deliberately flat — there is no role
 * inheritance. district-admin outranks school-manager in capability, but that is expressed
 * in the access functions, not by one role implicitly containing another. Flat roles are
 * auditable; inherited roles are how privilege quietly widens.
 */
export type Role = 'district-admin' | 'school-manager' | 'system-sync'

export const ROLES: readonly Role[] = ['district-admin', 'school-manager', 'system-sync'] as const

/** A tenant reference as Payload returns it — an id at depth 0, a document when populated. */
export type TenantRef = string | number | { id: string | number }

/**
 * The subset of the authenticated user this module reasons about. Intentionally a
 * hand-written structural type rather than Payload's generated `User`: these predicates are
 * the security core and must not silently change shape when the schema is regenerated.
 */
export type AuthUser = {
  id: string | number
  roles?: Role[] | null
  /** Shape supplied by @payloadcms/plugin-multi-tenant's users array field. */
  tenants?: { tenant?: TenantRef | null }[] | null
  /** Auto-approval scopes (`04` §4.3). `unknown` items: read only through `grantsOf`. */
  autoApprove?: unknown[] | null
}
