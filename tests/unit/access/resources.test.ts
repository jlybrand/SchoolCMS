import { describe, expect, it } from 'vitest'

import {
  PUBLIC_RESOURCE_CONSTRAINT,
  resourcesCreateAccess,
  resourcesReadAccess,
  resourcesWriteAccess,
} from '@/access/resources'
import type { AuthUser } from '@/access/types'

/**
 * The Resources library (Jason, 2026-11-13): ONE library of a site's files — images and
 * documents — in folders. Schools upload to their OWN school freely, with no approval (a file is
 * not on the site until an approved page uses it); the district works across every site.
 * Files are public: there is no staff-only setting until Entra (Jason). Reads return
 * CONSTRAINTS, never booleans, for anyone scoped (CLAUDE.md rule 2).
 */

const args = (user: AuthUser | null, extra: Record<string, unknown> = {}) =>
  ({ req: { user }, ...extra }) as never

const district: AuthUser = { id: 'u1', roles: ['district-admin'], tenants: [] }
const managerA: AuthUser = { id: 'u2', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
const managerAB: AuthUser = {
  id: 'u3',
  roles: ['school-manager'],
  tenants: [{ tenant: 'A' }, { tenant: 'B' }],
}
const managerNone: AuthUser = { id: 'u4', roles: ['school-manager'], tenants: [] }
const sync: AuthUser = { id: 'u5', roles: ['system-sync'], tenants: [] }

describe('reading', () => {
  it('the public reads every file — they are the website’s', () => {
    expect(resourcesReadAccess(args(null))).toEqual(PUBLIC_RESOURCE_CONSTRAINT)
  })

  it('the district reads every site’s', () => {
    expect(resourcesReadAccess(args(district))).toBe(true)
  })

  it('a school manager reads only their own school’s — in the dashboard as in the API', () => {
    expect(resourcesReadAccess(args(managerA))).toEqual({ tenant: { in: ['A'] } })
    expect(resourcesReadAccess(args(managerAB))).toEqual({ tenant: { in: ['A', 'B'] } })
    expect(resourcesReadAccess(args(managerNone))).toBe(false)
  })

  it('the sync has nothing to do here', () => {
    expect(resourcesReadAccess(args(sync))).toBe(false)
  })
})

describe('uploading', () => {
  it('a school manager uploads to their own school — no approval (Jason)', () => {
    expect(resourcesCreateAccess(args(managerA, { data: { tenant: 'A' } }))).toBe(true)
  })

  it('never to another school, nor with no school named', () => {
    expect(resourcesCreateAccess(args(managerA, { data: { tenant: 'B' } }))).toBe(false)
    expect(resourcesCreateAccess(args(managerA, { data: {} }))).toBe(false)
    expect(resourcesCreateAccess(args(managerNone, { data: { tenant: 'A' } }))).toBe(false)
  })

  it('the district anywhere; the sync and the signed-out never', () => {
    expect(resourcesCreateAccess(args(district))).toBe(true)
    expect(resourcesCreateAccess(args(sync, { data: { tenant: 'A' } }))).toBe(false)
    expect(resourcesCreateAccess(args(null, { data: { tenant: 'A' } }))).toBe(false)
  })
})

describe('changing and removing', () => {
  it('a school manager, their own school’s only — a constraint', () => {
    expect(resourcesWriteAccess(args(managerA))).toEqual({ tenant: { in: ['A'] } })
    expect(resourcesWriteAccess(args(managerNone))).toBe(false)
  })

  it('the district any; the sync and the signed-out none', () => {
    expect(resourcesWriteAccess(args(district))).toBe(true)
    expect(resourcesWriteAccess(args(sync))).toBe(false)
    expect(resourcesWriteAccess(args(null))).toBe(false)
  })
})
