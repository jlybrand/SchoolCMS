import { describe, expect, it } from 'vitest'

import { schoolListReadAccess, staffReadAccess } from '@/access/post-structure'
import type { AuthUser } from '@/access/types'

/**
 * Who reads the lists announcements are organised by (Jason, 2026-10-28): folders and boards,
 * one set per site, and one district-wide list of tags. The DISTRICT makes all three; writes are
 * `districtOnly` and need no test of their own here (`tenant-scoped.test.ts` has it).
 *
 * A school manager must READ their own site's folders and boards — they pick a board when
 * posting — and the tag list, which they tick from. Nothing else.
 */

const args = (user: AuthUser | null) => ({ req: { user } }) as never

const districtAdmin: AuthUser = { id: 'u1', roles: ['district-admin'], tenants: [] }
const managerA: AuthUser = { id: 'u2', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
const managerNoTenant: AuthUser = { id: 'u4', roles: ['school-manager'], tenants: [] }
const systemSync: AuthUser = { id: 'u5', roles: ['system-sync'], tenants: [{ tenant: 'A' }] }

describe('schoolListReadAccess — folders and boards', () => {
  it('lets the district read every site’s', () => {
    expect(schoolListReadAccess(args(districtAdmin))).toBe(true)
  })

  it('constrains a school manager to their own sites — a constraint, never true', () => {
    expect(schoolListReadAccess(args(managerA))).toEqual({ tenant: { in: ['A'] } })
  })

  it.each([
    ['a school manager with no school', managerNoTenant],
    ['the sync account', systemSync],
    ['anonymous', null],
  ])('denies %s', (_label, user) => {
    expect(schoolListReadAccess(args(user))).toBe(false)
  })
})

describe('staffReadAccess — the tag list', () => {
  it.each([
    ['the district', districtAdmin],
    ['a school manager', managerA],
  ])('lets %s read it', (_label, user) => {
    expect(staffReadAccess(args(user))).toBe(true)
  })

  it.each([
    ['the sync account', systemSync],
    ['anonymous', null],
  ])('denies %s', (_label, user) => {
    expect(staffReadAccess(args(user))).toBe(false)
  })
})
