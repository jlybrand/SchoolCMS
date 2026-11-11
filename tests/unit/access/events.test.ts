import { describe, expect, it } from 'vitest'

import {
  eventsCreateAccess,
  eventsDeleteAccess,
  eventsReadAccess,
  eventsReadVersionsAccess,
  eventsUpdateAccess,
  PUBLIC_EVENT_CONSTRAINT,
} from '@/access/events'
import type { AuthUser } from '@/access/types'

/**
 * Access control for `events` (`03` §2, §6.2) — calendar events (Jason, 2026-11-11).
 *
 * Reads and writes return a QUERY CONSTRAINT for any scoped user, as everywhere. What differs:
 * EVENTS DO NOT GO THROUGH APPROVAL (Jason, 2026-11-11) — a school manager publishes and removes
 * their OWN school's events directly. CLAUDE.md rule 3 is lifted for events only, by that
 * decision; another school's events stay out of reach (invariant 2). An event has no staff-only
 * setting, so the public constraint is the status alone.
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

describe('eventsReadAccess', () => {
  it('grants unrestricted read to district-admin', () => {
    expect(eventsReadAccess(args(districtAdmin))).toBe(true)
  })

  it('returns a query constraint for a school-manager — NEVER true', () => {
    const result = eventsReadAccess(args(managerA))
    expect(result).not.toBe(true)
    expect(result).toEqual({ tenant: { in: ['A'] } })
  })

  it('constrains to every assigned tenant for a multi-school manager', () => {
    expect(eventsReadAccess(args(managerAB))).toEqual({ tenant: { in: ['A', 'B'] } })
  })

  it('denies a school-manager with no tenant assignment', () => {
    expect(eventsReadAccess(args(managerNoTenant))).toBe(false)
  })

  it('DENIES system-sync outright — it owns no events', () => {
    expect(eventsReadAccess(args(systemSync))).toBe(false)
  })

  it('gives anonymous callers published, public events only', () => {
    expect(eventsReadAccess(args(null))).toEqual(PUBLIC_EVENT_CONSTRAINT)
  })

  it('the public constraint is published events — an event has no staff-only setting', () => {
    expect(PUBLIC_EVENT_CONSTRAINT).toEqual({ _status: { equals: 'published' } })
  })
})

describe('eventsCreateAccess', () => {
  it('allows district-admin to create in any tenant', () => {
    expect(eventsCreateAccess(args(districtAdmin, { data: { tenant: 'Z' } }))).toBe(true)
  })

  it('allows a school-manager inside their own tenant', () => {
    expect(eventsCreateAccess(args(managerA, { data: { tenant: 'A' } }))).toBe(true)
  })

  it('DENIES a school-manager creating into another tenant', () => {
    expect(eventsCreateAccess(args(managerA, { data: { tenant: 'B' } }))).toBe(false)
  })

  it('denies a create with no tenant — never fails open', () => {
    expect(eventsCreateAccess(args(managerA, { data: {} }))).toBe(false)
  })

  it.each([
    ['anonymous', null],
    ['system-sync', systemSync],
    ['a school-manager with no school', managerNoTenant],
  ])('denies %s', (_label, user) => {
    expect(eventsCreateAccess(args(user, { data: { tenant: 'A' } }))).toBe(false)
  })

  it('allows a school-manager to publish an event straight onto their own school’s calendar', () => {
    expect(
      eventsCreateAccess(args(managerA, { data: { tenant: 'A', _status: 'published' } })),
    ).toBe(true)
  })

  it('DENIES a school-manager publishing into another school', () => {
    expect(
      eventsCreateAccess(args(managerA, { data: { tenant: 'B', _status: 'published' } })),
    ).toBe(false)
  })

  it('allows a school-manager to create a draft', () => {
    expect(eventsCreateAccess(args(managerA, { data: { tenant: 'A', _status: 'draft' } }))).toBe(
      true,
    )
  })

  it('allows a school-manager an event with a date — when it HAPPENS is not when it goes live', () => {
    const data = { tenant: 'A', _status: 'draft', start: '2030-01-01T08:00:00.000Z' }
    expect(eventsCreateAccess(args(managerA, { data }))).toBe(true)
  })

  it('allows district-admin to create a published event directly', () => {
    expect(
      eventsCreateAccess(args(districtAdmin, { data: { tenant: 'A', _status: 'published' } })),
    ).toBe(true)
  })
})

describe('eventsUpdateAccess', () => {
  it('grants district-admin', () => {
    expect(eventsUpdateAccess(args(districtAdmin))).toBe(true)
  })

  it('returns a query constraint for a school-manager — NEVER true', () => {
    const result = eventsUpdateAccess(args(managerA, { data: { title: 'Edited' } }))
    expect(result).not.toBe(true)
    expect(result).toEqual({ tenant: { in: ['A'] } })
  })

  it.each([
    ['anonymous', null],
    ['system-sync', systemSync],
    ['a school-manager with no school', managerNoTenant],
  ])('denies %s', (_label, user) => {
    expect(eventsUpdateAccess(args(user))).toBe(false)
  })

  it('lets a school-manager publish — but only within their own school, as a constraint', () => {
    expect(
      eventsUpdateAccess(args(managerA, { data: { tenant: 'A', _status: 'published' } })),
    ).toEqual({ tenant: { in: ['A'] } })
  })

  it('still allows a school-manager to save a draft', () => {
    expect(eventsUpdateAccess(args(managerA, { data: { _status: 'draft' } }))).toEqual({
      tenant: { in: ['A'] },
    })
  })

  it('allows district-admin to publish', () => {
    expect(eventsUpdateAccess(args(districtAdmin, { data: { _status: 'published' } }))).toBe(true)
  })
})

describe('eventsDeleteAccess — a school removes its own events (Jason, 2026-11-11)', () => {
  it('grants district-admin', () => {
    expect(eventsDeleteAccess(args(districtAdmin))).toBe(true)
  })

  it('lets a school-manager delete within their own schools — a constraint, NEVER true', () => {
    expect(eventsDeleteAccess(args(managerA))).toEqual({ tenant: { in: ['A'] } })
    expect(eventsDeleteAccess(args(managerAB))).toEqual({ tenant: { in: ['A', 'B'] } })
  })

  it.each([
    ['a school-manager with no school', managerNoTenant],
    ['system-sync', systemSync],
    ['anonymous', null],
  ])('denies %s', (_label, user) => {
    expect(eventsDeleteAccess(args(user))).toBe(false)
  })
})

describe('eventsReadVersionsAccess — the history is the district’s, as on pages', () => {
  it('grants district-admin', () => {
    expect(eventsReadVersionsAccess(args(districtAdmin))).toBe(true)
  })

  it.each([
    ['school-manager — even in their own school', managerA],
    ['system-sync', systemSync],
    ['anonymous', null],
  ])('denies %s outright', (_label, user) => {
    expect(eventsReadVersionsAccess(args(user))).toBe(false)
  })
})
