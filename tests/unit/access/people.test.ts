import { describe, expect, it } from 'vitest'

import {
  cmsOwnedField,
  groupDeleteAccess,
  groupNameUpdate,
  peopleCreateAccess,
  peopleDeleteAccess,
  peopleReadAccess,
  peopleWriteAccess,
  syncOnlyField,
} from '@/access/people'
import type { AuthUser } from '@/access/types'

/**
 * Staff directories (Jason, 2026-11-13). Every staff member comes from CSI — none is added in the
 * dashboard — and only the district edits anything here. A school's group is its CSI location;
 * the district makes SUB-GROUPS inside it (Nurses, Counselors, Teachers…) and picks who is in
 * them. The sync (`system-sync`) writes what comes from CSI and nothing else.
 */

const args = (user: AuthUser | null, extra: Record<string, unknown> = {}) =>
  ({ req: { user }, ...extra }) as never

const district: AuthUser = { id: 'u1', roles: ['district-admin'], tenants: [] }
const manager: AuthUser = { id: 'u2', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
const sync: AuthUser = { id: 'u3', roles: ['system-sync'], tenants: [] }

const schoolGroup = { doc: { csiLocationId: 'SHS', parent: null } }
const subGroup = { doc: { parent: 7 } }

describe('people', () => {
  it('the district and the sync read and update; nobody else', () => {
    for (const access of [peopleReadAccess, peopleWriteAccess]) {
      expect(access(args(district))).toBe(true)
      expect(access(args(sync))).toBe(true)
      expect(access(args(manager))).toBe(false)
      expect(access(args(null))).toBe(false)
    }
  })

  it('only the sync creates a staff member — they all come from CSI (Jason)', () => {
    expect(peopleCreateAccess(args(sync))).toBe(true)
    expect(peopleCreateAccess(args(district))).toBe(false)
    expect(peopleCreateAccess(args(manager))).toBe(false)
    expect(peopleCreateAccess(args(null))).toBe(false)
  })

  it('only the district deletes — a departure is hidden by the sync, never deleted', () => {
    expect(peopleDeleteAccess(args(district))).toBe(true)
    expect(peopleDeleteAccess(args(sync))).toBe(false)
    expect(peopleDeleteAccess(args(manager))).toBe(false)
  })
})

describe('fields from CSI', () => {
  it('the sync alone writes them — read-only to the district, they change in CSI', () => {
    expect(syncOnlyField(args(sync))).toBe(true)
    expect(syncOnlyField(args(district))).toBe(false)
    expect(syncOnlyField(args(manager))).toBe(false)
    expect(syncOnlyField(args(null))).toBe(false)
  })
})

describe('the dashboard’s own fields (sort name, who is in a sub-group)', () => {
  it('the district only — a sync never overwrites them', () => {
    expect(cmsOwnedField(args(district))).toBe(true)
    expect(cmsOwnedField(args(sync))).toBe(false)
    expect(cmsOwnedField(args(manager))).toBe(false)
    expect(cmsOwnedField(args(null))).toBe(false)
  })
})

describe('a group’s name', () => {
  it('a school’s group is named by CSI — the sync only', () => {
    expect(groupNameUpdate(args(sync, schoolGroup))).toBe(true)
    expect(groupNameUpdate(args(district, schoolGroup))).toBe(false)
  })

  it('a sub-group is named by the district — never the sync', () => {
    expect(groupNameUpdate(args(district, subGroup))).toBe(true)
    expect(groupNameUpdate(args(sync, subGroup))).toBe(false)
  })

  it('never a school manager', () => {
    expect(groupNameUpdate(args(manager, subGroup))).toBe(false)
  })
})

describe('deleting a group', () => {
  it('the district deletes sub-groups only — a school’s group goes when CSI drops it', () => {
    expect(groupDeleteAccess(args(district))).toEqual({ parent: { exists: true } })
    expect(groupDeleteAccess(args(sync))).toBe(false)
    expect(groupDeleteAccess(args(manager))).toBe(false)
    expect(groupDeleteAccess(args(null))).toBe(false)
  })
})
