import { describe, expect, it } from 'vitest'

import {
  denyAll,
  districtOnly,
  selfOrDistrictAdmin,
  tenantCreateAccess,
  tenantReadAccess,
  tenantWriteAccess,
} from '@/access/tenant-scoped'
import type { AuthUser } from '@/access/types'

/**
 * Access functions for tenant-owned collections (`03` §6.2).
 *
 * THE LOAD-BEARING PROPERTY under test here: `read` returns a QUERY CONSTRAINT, never a
 * bare `true` for a scoped user. A boolean would hand back the whole collection and let the
 * UI do the filtering — which is exactly the class of mistake that leaks one school's
 * drafts into another school's list view (`03` §6.4 invariant 1).
 *
 * Because Payload owns the DB connection, Postgres row-level security is unavailable
 * (`02` §4.2), so these functions plus the integration suite in
 * tests/integration/tenant-isolation.test.ts ARE the isolation guarantee.
 */

/** Builds access-function args. Cast at the boundary so call sites stay readable. */
const args = (user: AuthUser | null, extra: Record<string, unknown> = {}) =>
  ({ req: { user }, ...extra }) as never

const districtAdmin: AuthUser = { id: 'u1', roles: ['district-admin'], tenants: [] }
const managerA: AuthUser = { id: 'u2', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
const managerAB: AuthUser = {
  id: 'u3',
  roles: ['school-manager'],
  tenants: [{ tenant: 'A' }, { tenant: 'B' }],
}
const managerNoTenant: AuthUser = { id: 'u4', roles: ['school-manager'], tenants: [] }
const systemSync: AuthUser = { id: 'u5', roles: ['system-sync'], tenants: [{ tenant: 'A' }] }

describe('tenantReadAccess', () => {
  it('grants unrestricted read to district-admin', () => {
    expect(tenantReadAccess(args(districtAdmin))).toBe(true)
  })

  it('returns a query constraint for a school-manager — NEVER true', () => {
    const result = tenantReadAccess(args(managerA))
    expect(result).not.toBe(true)
    expect(result).toEqual({ tenant: { in: ['A'] } })
  })

  it('constrains to every assigned tenant for a multi-school manager', () => {
    expect(tenantReadAccess(args(managerAB))).toEqual({ tenant: { in: ['A', 'B'] } })
  })

  it('denies a school-manager with no tenant assignment', () => {
    // An empty `in` clause would match nothing, but returning false is unambiguous and
    // cannot be defeated by a query-builder that drops empty arrays.
    expect(tenantReadAccess(args(managerNoTenant))).toBe(false)
  })

  it('constrains system-sync to its mapped tenants', () => {
    expect(tenantReadAccess(args(systemSync))).toEqual({ tenant: { in: ['A'] } })
  })

  it('denies unauthenticated requests — deny by default', () => {
    expect(tenantReadAccess(args(null))).toBe(false)
  })
})

describe('tenantCreateAccess', () => {
  it('allows district-admin to create in any tenant', () => {
    expect(tenantCreateAccess(args(districtAdmin, { data: { tenant: 'Z' } }))).toBe(true)
  })

  it('allows a school-manager inside their own tenant', () => {
    expect(tenantCreateAccess(args(managerA, { data: { tenant: 'A' } }))).toBe(true)
  })

  it('DENIES a school-manager creating into another tenant', () => {
    // `03` §6.4 invariant 2 — the core cross-tenant write denial.
    expect(tenantCreateAccess(args(managerA, { data: { tenant: 'B' } }))).toBe(false)
  })

  it('denies when the target tenant is absent — never fail open', () => {
    expect(tenantCreateAccess(args(managerA, { data: {} }))).toBe(false)
    expect(tenantCreateAccess(args(managerA))).toBe(false)
  })

  it('handles populated tenant relationships', () => {
    expect(tenantCreateAccess(args(managerA, { data: { tenant: { id: 'A' } } }))).toBe(true)
    expect(tenantCreateAccess(args(managerA, { data: { tenant: { id: 'B' } } }))).toBe(false)
  })

  it('denies a school-manager with no tenant assignment', () => {
    expect(tenantCreateAccess(args(managerNoTenant, { data: { tenant: 'A' } }))).toBe(false)
  })

  it('denies unauthenticated requests', () => {
    expect(tenantCreateAccess(args(null, { data: { tenant: 'A' } }))).toBe(false)
  })
})

describe('tenantWriteAccess (update / delete)', () => {
  /**
   * Payload's access args carry `id` and `data`, NOT the existing document. So this MUST
   * return a query constraint: a boolean judged from `data` alone would be satisfied by a
   * partial update that simply omits the tenant field, letting a school-manager edit
   * another school's row. The constraint makes the database the arbiter.
   */
  it('grants district-admin unrestricted write', () => {
    expect(tenantWriteAccess(args(districtAdmin))).toBe(true)
  })

  it('returns a query constraint for a school-manager — NEVER true', () => {
    const result = tenantWriteAccess(args(managerA))
    expect(result).not.toBe(true)
    expect(result).toEqual({ tenant: { in: ['A'] } })
  })

  it('constrains a multi-school manager to every assigned tenant', () => {
    expect(tenantWriteAccess(args(managerAB))).toEqual({ tenant: { in: ['A', 'B'] } })
  })

  it('denies a school-manager with no tenant assignment', () => {
    expect(tenantWriteAccess(args(managerNoTenant))).toBe(false)
  })

  it('denies unauthenticated requests', () => {
    expect(tenantWriteAccess(args(null))).toBe(false)
  })
})

describe('districtOnly', () => {
  it('allows only district-admin', () => {
    expect(districtOnly(args(districtAdmin))).toBe(true)
    expect(districtOnly(args(managerA))).toBe(false)
    expect(districtOnly(args(systemSync))).toBe(false)
    expect(districtOnly(args(null))).toBe(false)
  })
})

describe('denyAll', () => {
  it('denies everyone, including district-admin', () => {
    // Used where a capability must not exist by any route, e.g. deleting audit history.
    expect(denyAll(args(districtAdmin))).toBe(false)
    expect(denyAll(args(managerA))).toBe(false)
    expect(denyAll(args(null))).toBe(false)
  })
})

describe('selfOrDistrictAdmin', () => {
  it('grants district-admin unrestricted read of user records', () => {
    expect(selfOrDistrictAdmin(args(districtAdmin))).toBe(true)
  })

  it('constrains everyone else to their OWN record', () => {
    // `03` §6.4 invariant 4 — the public surface never returns user records, and a
    // school-manager cannot enumerate other staff.
    expect(selfOrDistrictAdmin(args(managerA))).toEqual({ id: { equals: 'u2' } })
    expect(selfOrDistrictAdmin(args(systemSync))).toEqual({ id: { equals: 'u5' } })
  })

  it('denies unauthenticated requests', () => {
    expect(selfOrDistrictAdmin(args(null))).toBe(false)
  })
})
