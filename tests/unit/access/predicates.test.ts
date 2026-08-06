import { describe, expect, it } from 'vitest'

import {
  hasTenant,
  isDistrictAdmin,
  isSchoolManager,
  isSystemSync,
  tenantIdsFor,
} from '@/access/predicates'
import type { AuthUser } from '@/access/types'

/**
 * Table-driven role/tenant predicates (`06` §2.1 — "the security core; highest priority").
 *
 * These are the primitives every access function is built from, so they are tested
 * exhaustively including the null/undefined/malformed shapes that a real request can
 * produce. Deny by default means the absence of a user is never an accident.
 */

const districtAdmin: AuthUser = { id: 'u1', roles: ['district-admin'], tenants: [] }
const schoolManager: AuthUser = {
  id: 'u2',
  roles: ['school-manager'],
  tenants: [{ tenant: 't-summerville' }],
}
const multiSchoolManager: AuthUser = {
  id: 'u3',
  roles: ['school-manager'],
  tenants: [{ tenant: 't-summerville' }, { tenant: 't-ashley-ridge' }],
}
const systemSync: AuthUser = {
  id: 'u4',
  roles: ['system-sync'],
  tenants: [{ tenant: 't-summerville' }],
}
const roleless: AuthUser = { id: 'u5', roles: [], tenants: [] }

describe('role predicates', () => {
  describe('isDistrictAdmin', () => {
    it('is true only for district-admin', () => {
      expect(isDistrictAdmin(districtAdmin)).toBe(true)
      expect(isDistrictAdmin(schoolManager)).toBe(false)
      expect(isDistrictAdmin(systemSync)).toBe(false)
      expect(isDistrictAdmin(roleless)).toBe(false)
    })

    it('denies for absent or malformed users', () => {
      expect(isDistrictAdmin(null)).toBe(false)
      expect(isDistrictAdmin(undefined)).toBe(false)
      expect(isDistrictAdmin({ id: 'x' })).toBe(false)
      expect(isDistrictAdmin({ id: 'x', roles: null })).toBe(false)
    })

    it('does not grant district-admin via a lookalike string', () => {
      // Guards against substring or case-insensitive matching bugs.
      expect(isDistrictAdmin({ id: 'x', roles: ['District-Admin' as never] })).toBe(false)
      expect(isDistrictAdmin({ id: 'x', roles: ['not-district-admin' as never] })).toBe(false)
      expect(isDistrictAdmin({ id: 'x', roles: ['district-admin-readonly' as never] })).toBe(false)
    })
  })

  describe('isSchoolManager / isSystemSync', () => {
    it('identify their own role only', () => {
      expect(isSchoolManager(schoolManager)).toBe(true)
      expect(isSchoolManager(districtAdmin)).toBe(false)
      expect(isSystemSync(systemSync)).toBe(true)
      expect(isSystemSync(schoolManager)).toBe(false)
    })

    it('denies for absent users', () => {
      expect(isSchoolManager(null)).toBe(false)
      expect(isSystemSync(null)).toBe(false)
    })

    it('does not treat district-admin as implicitly holding other roles', () => {
      // district-admin outranks school-manager but IS NOT one. Role checks stay literal;
      // capability is expressed in the access functions, not by role inheritance.
      expect(isSchoolManager(districtAdmin)).toBe(false)
      expect(isSystemSync(districtAdmin)).toBe(false)
    })
  })
})

describe('tenantIdsFor', () => {
  it('returns assigned tenant ids', () => {
    expect(tenantIdsFor(schoolManager)).toEqual(['t-summerville'])
    expect(tenantIdsFor(multiSchoolManager)).toEqual(['t-summerville', 't-ashley-ridge'])
  })

  it('unwraps populated tenant relationships', () => {
    // Payload returns either an id or a populated doc depending on depth.
    const populated: AuthUser = {
      id: 'u6',
      roles: ['school-manager'],
      tenants: [{ tenant: { id: 't-summerville' } }],
    }
    expect(tenantIdsFor(populated)).toEqual(['t-summerville'])
  })

  it('returns an empty list for absent, empty, or malformed assignments', () => {
    expect(tenantIdsFor(null)).toEqual([])
    expect(tenantIdsFor(undefined)).toEqual([])
    expect(tenantIdsFor(districtAdmin)).toEqual([])
    expect(tenantIdsFor({ id: 'x', tenants: null })).toEqual([])
  })

  it('drops null and malformed rows rather than emitting undefined ids', () => {
    // A malformed row must never become a tenant id that could match something.
    const messy = {
      id: 'u7',
      roles: ['school-manager'],
      tenants: [{ tenant: 't-real' }, { tenant: null }, {}, null],
    } as unknown as AuthUser
    expect(tenantIdsFor(messy)).toEqual(['t-real'])
  })

  it('coerces numeric ids to strings so comparisons never rely on type juggling', () => {
    const numeric = {
      id: 'u8',
      roles: ['school-manager'],
      tenants: [{ tenant: 42 }],
    } as unknown as AuthUser
    expect(tenantIdsFor(numeric)).toEqual(['42'])
  })
})

describe('hasTenant', () => {
  it('is true only for assigned tenants', () => {
    expect(hasTenant(schoolManager, 't-summerville')).toBe(true)
    expect(hasTenant(schoolManager, 't-ashley-ridge')).toBe(false)
    expect(hasTenant(multiSchoolManager, 't-ashley-ridge')).toBe(true)
  })

  it('does NOT special-case district-admin', () => {
    /**
     * district-admin holds cross-tenant capability, but that is granted in the access
     * functions, not smuggled into a tenant-membership check. Keeping this predicate
     * literal is what makes the access functions auditable.
     */
    expect(hasTenant(districtAdmin, 't-summerville')).toBe(false)
  })

  it('denies for absent users and empty tenant ids', () => {
    expect(hasTenant(null, 't-summerville')).toBe(false)
    expect(hasTenant(schoolManager, '')).toBe(false)
    expect(hasTenant(schoolManager, null)).toBe(false)
    expect(hasTenant(schoolManager, undefined)).toBe(false)
  })

  it('matches numeric and string ids consistently', () => {
    const numeric = {
      id: 'u9',
      roles: ['school-manager'],
      tenants: [{ tenant: 42 }],
    } as unknown as AuthUser
    expect(hasTenant(numeric, 42 as never)).toBe(true)
    expect(hasTenant(numeric, '42')).toBe(true)
  })
})
