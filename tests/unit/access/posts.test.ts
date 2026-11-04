import { describe, expect, it } from 'vitest'

import {
  postsCreateAccess,
  postsDeleteAccess,
  postsReadAccess,
  postsReadVersionsAccess,
  postsUpdateAccess,
  PUBLIC_POST_CONSTRAINT,
} from '@/access/posts'
import type { AuthUser } from '@/access/types'

/**
 * Access control for `posts` (`03` §2, §6.2) — news and announcements.
 *
 * The same two load-bearing properties as `pages` (tests/unit/access/pages.test.ts): reads
 * return a QUERY CONSTRAINT for any scoped user, and a `school-manager` cannot publish BY ANY
 * ROUTE. Posts have no composed type, so there is no third gate; syndication is gated at FIELD
 * level in the collection config and proven over the real stack in
 * tests/integration/tenant-isolation.test.ts.
 */

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

describe('postsReadAccess', () => {
  it('grants unrestricted read to district-admin', () => {
    expect(postsReadAccess(args(districtAdmin))).toBe(true)
  })

  it('returns a query constraint for a school-manager — NEVER true', () => {
    const result = postsReadAccess(args(managerA))
    expect(result).not.toBe(true)
    expect(result).toEqual({ tenant: { in: ['A'] } })
  })

  it('constrains to every assigned tenant for a multi-school manager', () => {
    expect(postsReadAccess(args(managerAB))).toEqual({ tenant: { in: ['A', 'B'] } })
  })

  it('denies a school-manager with no tenant assignment', () => {
    expect(postsReadAccess(args(managerNoTenant))).toBe(false)
  })

  it('DENIES system-sync outright — it owns no posts', () => {
    expect(postsReadAccess(args(systemSync))).toBe(false)
  })

  it('gives anonymous callers published, public posts only', () => {
    expect(postsReadAccess(args(null))).toEqual(PUBLIC_POST_CONSTRAINT)
  })

  it('the public constraint filters BOTH status and visibility', () => {
    expect(PUBLIC_POST_CONSTRAINT).toEqual({
      and: [{ _status: { equals: 'published' } }, { visibility: { equals: 'public' } }],
    })
  })
})

describe('postsCreateAccess', () => {
  it('allows district-admin to create in any tenant', () => {
    expect(postsCreateAccess(args(districtAdmin, { data: { tenant: 'Z' } }))).toBe(true)
  })

  it('allows a school-manager inside their own tenant', () => {
    expect(postsCreateAccess(args(managerA, { data: { tenant: 'A' } }))).toBe(true)
  })

  it('DENIES a school-manager creating into another tenant', () => {
    expect(postsCreateAccess(args(managerA, { data: { tenant: 'B' } }))).toBe(false)
  })

  it('denies a create with no tenant — never fails open', () => {
    expect(postsCreateAccess(args(managerA, { data: {} }))).toBe(false)
  })

  it.each([
    ['anonymous', null],
    ['system-sync', systemSync],
    ['a school-manager with no school', managerNoTenant],
  ])('denies %s', (_label, user) => {
    expect(postsCreateAccess(args(user, { data: { tenant: 'A' } }))).toBe(false)
  })

  it('DENIES a school-manager creating a post already marked published', () => {
    expect(postsCreateAccess(args(managerA, { data: { tenant: 'A', _status: 'published' } }))).toBe(
      false,
    )
  })

  it('allows a school-manager to create a draft', () => {
    expect(postsCreateAccess(args(managerA, { data: { tenant: 'A', _status: 'draft' } }))).toBe(
      true,
    )
  })

  it('allows district-admin to create a published post directly', () => {
    expect(
      postsCreateAccess(args(districtAdmin, { data: { tenant: 'A', _status: 'published' } })),
    ).toBe(true)
  })
})

describe('postsUpdateAccess', () => {
  it('grants district-admin', () => {
    expect(postsUpdateAccess(args(districtAdmin))).toBe(true)
  })

  it('returns a query constraint for a school-manager — NEVER true', () => {
    const result = postsUpdateAccess(args(managerA, { data: { title: 'Edited' } }))
    expect(result).not.toBe(true)
    expect(result).toEqual({ tenant: { in: ['A'] } })
  })

  it.each([
    ['anonymous', null],
    ['system-sync', systemSync],
    ['a school-manager with no school', managerNoTenant],
  ])('denies %s', (_label, user) => {
    expect(postsUpdateAccess(args(user))).toBe(false)
  })

  it('DENIES a school-manager publishing — in their OWN tenant too', () => {
    expect(postsUpdateAccess(args(managerA, { data: { tenant: 'A', _status: 'published' } }))).toBe(
      false,
    )
  })

  it('DENIES a school-manager a Start — a scheduled publish is a publish (Jason, 2026-11-04)', () => {
    const start = { tenant: 'A', _status: 'draft', publishAt: '2030-01-01T08:00:00.000Z' }
    expect(postsUpdateAccess(args(managerA, { data: start }))).toBe(false)
    expect(postsCreateAccess(args(managerA, { data: start }))).toBe(false)
  })

  it('still allows a school-manager to save a draft', () => {
    expect(
      postsUpdateAccess(args(managerA, { data: { _status: 'draft', publishAt: null } })),
    ).toEqual({
      tenant: { in: ['A'] },
    })
    expect(postsUpdateAccess(args(managerA, { data: { _status: 'draft' } }))).toEqual({
      tenant: { in: ['A'] },
    })
  })

  it('allows district-admin to publish', () => {
    expect(postsUpdateAccess(args(districtAdmin, { data: { _status: 'published' } }))).toBe(true)
  })
})

describe('postsDeleteAccess', () => {
  it('is reserved to district-admin', () => {
    expect(postsDeleteAccess(args(districtAdmin))).toBe(true)
  })

  it.each([
    ['school-manager', managerA],
    ['system-sync', systemSync],
    ['anonymous', null],
  ])('denies %s', (_label, user) => {
    expect(postsDeleteAccess(args(user))).toBe(false)
  })
})

describe('postsReadVersionsAccess — the history is the district’s, as on pages', () => {
  it('grants district-admin', () => {
    expect(postsReadVersionsAccess(args(districtAdmin))).toBe(true)
  })

  it.each([
    ['school-manager — even in their own school', managerA],
    ['system-sync', systemSync],
    ['anonymous', null],
  ])('denies %s outright', (_label, user) => {
    expect(postsReadVersionsAccess(args(user))).toBe(false)
  })
})
