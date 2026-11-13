import { describe, expect, it } from 'vitest'

import { planStaffSync, type StaffRecord } from '@/lib/csi/plan'

/**
 * One sync's changes (Jason, 2026-11-13; `11` §6–§7). Upsert by CSI id; only what changed is
 * written, so an unchanged feed is a no-op; someone gone from the feed is HIDDEN, never deleted;
 * someone back is shown again; a school's group is made for a new location and renamed with it.
 * A feed that would empty the directory or hide a large share of it is refused whole —
 * last-known-good beats empty (`11` §7).
 */

const rec = (over: Partial<StaffRecord> = {}): StaffRecord => ({
  csiId: 'E1',
  name: 'Jane Smith',
  email: 'jane@example.org',
  title: 'Teacher',
  locationId: 'L-SHS',
  locationName: 'SHS',
  ...over,
})

const schools = [{ id: 1, csiLocationId: 'L-SHS', name: 'SHS' }]
const person = (over: Record<string, unknown> = {}) => ({
  id: 10,
  csiId: 'E1',
  name: 'Jane Smith',
  email: 'jane@example.org',
  title: 'Teacher',
  group: 1,
  active: true,
  ...over,
})

describe('upsert by CSI id', () => {
  it('a new person is created, in their school', () => {
    const plan = planStaffSync([rec()], { people: [], schools })
    expect(plan).toMatchObject({ ok: true, create: [rec()], update: [], hide: [] })
  })

  it('an unchanged feed changes nothing — no churn, no versions', () => {
    const plan = planStaffSync([rec()], { people: [person()], schools })
    expect(plan).toMatchObject({ ok: true, create: [], update: [], hide: [], schools: [] })
  })

  it('only what changed is written', () => {
    const plan = planStaffSync([rec({ title: 'Assistant Principal' })], {
      people: [person()],
      schools,
    })
    expect(plan).toMatchObject({
      ok: true,
      update: [{ id: 10, data: { title: 'Assistant Principal' } }],
    })
  })

  it('a move to another school changes their school', () => {
    const plan = planStaffSync([rec({ locationId: 'L-AMS', locationName: 'AMS' })], {
      people: [person()],
      schools: [...schools, { id: 2, csiLocationId: 'L-AMS', name: 'AMS' }],
    })
    expect(plan).toMatchObject({ ok: true, update: [{ id: 10, data: { locationId: 'L-AMS' } }] })
  })
})

describe('departures and returns', () => {
  const team = Array.from({ length: 10 }, (_, i) => person({ id: 100 + i, csiId: `E${100 + i}` }))
  const feed = team.map((p) => rec({ csiId: p.csiId as string }))

  it('someone gone from the feed is hidden — never deleted', () => {
    const plan = planStaffSync(feed.slice(1), { people: team, schools })
    expect(plan).toMatchObject({ ok: true, hide: [100] })
  })

  it('someone already hidden is not hidden again', () => {
    const plan = planStaffSync(feed.slice(1), {
      people: [person({ id: 100, csiId: 'E100', active: false }), ...team.slice(1)],
      schools,
    })
    expect(plan).toMatchObject({ ok: true, hide: [] })
  })

  it('someone back in the feed is shown again', () => {
    const plan = planStaffSync(feed, {
      people: [person({ id: 100, csiId: 'E100', active: false }), ...team.slice(1)],
      schools,
    })
    expect(plan).toMatchObject({ ok: true, update: [{ id: 100, data: { active: true } }] })
  })
})

describe('school groups', () => {
  it('a new location gets its group', () => {
    const plan = planStaffSync([rec({ locationId: 'L-NEW', locationName: 'New Elementary' })], {
      people: [],
      schools,
    })
    expect(plan).toMatchObject({
      ok: true,
      schools: [{ csiLocationId: 'L-NEW', name: 'New Elementary' }],
    })
  })

  it('a renamed location renames its group', () => {
    const plan = planStaffSync([rec({ locationName: 'Southside High' })], {
      people: [person()],
      schools,
    })
    expect(plan).toMatchObject({
      ok: true,
      schools: [{ id: 1, csiLocationId: 'L-SHS', name: 'Southside High' }],
    })
  })
})

describe('last-known-good: a feed that looks wrong is refused whole', () => {
  it('an empty feed changes nothing', () => {
    expect(planStaffSync([], { people: [person()], schools })).toEqual({
      ok: false,
      reason: 'The CSI feed had no staff in it. Nothing was changed.',
    })
  })

  it('a feed that would hide more than a quarter of the directory changes nothing', () => {
    const team = Array.from({ length: 20 }, (_, i) => person({ id: i, csiId: `E${i}` }))
    const plan = planStaffSync(
      team.slice(0, 14).map((p) => rec({ csiId: p.csiId as string })),
      { people: team, schools },
    )
    expect(plan).toEqual({
      ok: false,
      reason:
        'The CSI feed would hide 6 of 20 staff (more than a quarter). Nothing was changed — check the feed, then sync again.',
    })
  })

  it('a handful of departures in a small directory is normal', () => {
    const team = Array.from({ length: 6 }, (_, i) => person({ id: i, csiId: `E${i}` }))
    const plan = planStaffSync(
      team.slice(0, 3).map((p) => rec({ csiId: p.csiId as string })),
      { people: team, schools },
    )
    expect(plan).toMatchObject({ ok: true, hide: [3, 4, 5] })
  })
})
