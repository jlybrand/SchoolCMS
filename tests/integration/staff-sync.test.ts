import type { Payload } from 'payload'
import { beforeEach, beforeAll, describe, expect, it } from 'vitest'

import withStudents from '../fixtures/csi/staff-with-students.json'

import { staffSyncEndpoint } from '@/collections/endpoints/staff-sync'
import { MOCK_CSI_ROWS } from '@/sync/csi-mock'
import { runStaffSync, type StaffSource } from '@/sync/staff-sync'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * The CSI staff sync over the real stack (Jason, 2026-11-13; `11` §6–§9, the source now CSI). It
 * writes as the sync — access rules on, not overridden — so what it may touch is proved here too.
 * Release-blocking: a feed with student rows leaves NO student record behind (CLAUDE.md rule 4).
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

beforeEach(async () => {
  await payload.delete({ collection: 'people', where: {}, overrideAccess: true })
  await payload.delete({ collection: 'staff-groups', where: {}, overrideAccess: true })
})

const source = (rows: unknown[]): StaffSource => ({ name: 'test', fetchRows: async () => rows })

const row = (id: string, over: Record<string, unknown> = {}) => ({
  employeeId: id,
  name: `Person ${id}`,
  email: `${id.toLowerCase()}@example.org`,
  title: 'Teacher',
  locationId: 'L-SHS',
  locationName: 'SHS',
  ...over,
})

const people = async () =>
  (
    await payload.find({
      collection: 'people',
      limit: 0,
      pagination: false,
      depth: 0,
      overrideAccess: true,
      sort: 'csiId',
    })
  ).docs

const byCsi = async (csiId: string) => (await people()).find((p) => p.csiId === csiId)

describe('NO STUDENT DATA (release-blocking)', () => {
  it('a feed with student rows creates staff only — and no student detail anywhere', async () => {
    const summary = await runStaffSync(payload, source(withStudents), new Date())
    expect(summary).toMatchObject({ ok: true, created: 4, dropped: { student: 5 } })
    const stored = await people()
    expect(stored.map((p) => p.csiId)).toEqual(['E100', 'E101', 'E102', 'E103'])
    expect(JSON.stringify(stored)).not.toMatch(/Mockchild|Rowe|Learner|Pupil|Minor|Elm St|55000/)
    expect(JSON.stringify(summary)).not.toMatch(/Mockchild|Rowe|Learner|Pupil|Minor/)
  })
})

describe('a first sync', () => {
  it('makes each school’s group and puts its staff in it', async () => {
    const summary = await runStaffSync(payload, source(withStudents), new Date())
    expect(summary).toMatchObject({ schoolsCreated: 2 })
    const groups = (
      await payload.find({
        collection: 'staff-groups',
        depth: 0,
        overrideAccess: true,
        sort: 'name',
      })
    ).docs
    expect(groups.map((g) => [g.name, g.csiLocationId])).toEqual([
      ['AMS', 'L-AMS'],
      ['SHS', 'L-SHS'],
    ])
    const dana = await byCsi('E103')
    expect(dana).toMatchObject({ name: 'Dana Example', title: 'Nurse', active: true })
    expect(dana?.group).toBe(groups[0]!.id)
    expect(dana?.syncedAt).toBeTruthy()
  })
})

describe('the next syncs', () => {
  it('an unchanged feed is a no-op — nothing rewritten', async () => {
    await runStaffSync(payload, source([row('E1'), row('E2')]), new Date())
    const before = (await people()).map((p) => p.updatedAt)
    const summary = await runStaffSync(payload, source([row('E1'), row('E2')]), new Date())
    expect(summary).toMatchObject({ ok: true, created: 0, updated: 0, hidden: 0 })
    expect((await people()).map((p) => p.updatedAt)).toEqual(before)
  })

  it('a change in CSI is written; the district’s sort name and sub-groups survive it', async () => {
    await runStaffSync(payload, source([row('E1', { name: 'Maria de la Cruz' })]), new Date())
    const maria = (await byCsi('E1'))!
    await payload.update({
      collection: 'people',
      id: maria.id,
      data: { sortName: 'de la Cruz, Maria' },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const nurses = await payload.create({
      collection: 'staff-groups',
      data: { name: 'Nurses', parent: maria.group as number, members: [maria.id] },
      user: f.districtAdmin,
      overrideAccess: false,
    })

    const summary = await runStaffSync(
      payload,
      source([row('E1', { name: 'Maria de la Cruz', title: 'Nurse' })]),
      new Date(),
    )
    expect(summary).toMatchObject({ ok: true, updated: 1 })
    expect(await byCsi('E1')).toMatchObject({ title: 'Nurse', sortName: 'de la Cruz, Maria' })
    const group = await payload.findByID({
      collection: 'staff-groups',
      id: nurses.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(group.members).toEqual([maria.id])
  })

  it('someone gone is hidden, not deleted; back again, shown', async () => {
    await runStaffSync(payload, source([row('E1'), row('E2')]), new Date())
    expect(await runStaffSync(payload, source([row('E1')]), new Date())).toMatchObject({
      hidden: 1,
    })
    expect(await byCsi('E2')).toMatchObject({ active: false })
    await runStaffSync(payload, source([row('E1'), row('E2')]), new Date())
    expect(await byCsi('E2')).toMatchObject({ active: true })
  })

  it('a renamed location renames its group; a move changes the person’s school', async () => {
    await runStaffSync(payload, source([row('E1'), row('E2')]), new Date())
    await runStaffSync(
      payload,
      source([
        row('E1', { locationName: 'Southside High' }),
        row('E2', { locationId: 'L-AMS', locationName: 'AMS' }),
      ]),
      new Date(),
    )
    const groups = (
      await payload.find({ collection: 'staff-groups', depth: 0, overrideAccess: true })
    ).docs
    const shs = groups.find((g) => g.csiLocationId === 'L-SHS')!
    const ams = groups.find((g) => g.csiLocationId === 'L-AMS')!
    expect(shs).toMatchObject({ name: 'Southside High', label: 'Southside High' })
    expect((await byCsi('E2'))?.group).toBe(ams.id)
  })

  it('someone who moved drops out of the old school’s sub-group on its next save', async () => {
    await runStaffSync(payload, source([row('E1'), row('E2')]), new Date())
    const [e1, e2] = [(await byCsi('E1'))!, (await byCsi('E2'))!]
    const nurses = await payload.create({
      collection: 'staff-groups',
      data: { name: 'Nurses', parent: e1.group as number, members: [e1.id, e2.id] },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await runStaffSync(
      payload,
      source([row('E1'), row('E2', { locationId: 'L-AMS', locationName: 'AMS' })]),
      new Date(),
    )
    const renamed = await payload.update({
      collection: 'staff-groups',
      id: nurses.id,
      data: { name: 'School nurses' },
      user: f.districtAdmin,
      overrideAccess: false,
      depth: 0,
    })
    expect(renamed.members).toEqual([e1.id])
  })
})

describe('last-known-good — a bad feed changes nothing', () => {
  it('CSI unreachable', async () => {
    await runStaffSync(payload, source([row('E1')]), new Date())
    const failing: StaffSource = {
      name: 'test',
      fetchRows: async () => {
        throw new Error('ECONNREFUSED')
      },
    }
    expect(await runStaffSync(payload, failing, new Date())).toEqual({
      ok: false,
      reason: 'Could not read from CSI. Nothing was changed.',
    })
    expect(await byCsi('E1')).toMatchObject({ active: true })
  })

  it('an empty feed, or one that would hide most of the staff', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => row(`E${i}`))
    await runStaffSync(payload, source(ten), new Date())
    expect(await runStaffSync(payload, source([]), new Date())).toMatchObject({ ok: false })
    expect(await runStaffSync(payload, source(ten.slice(0, 2)), new Date())).toMatchObject({
      ok: false,
    })
    expect((await people()).every((p) => p.active)).toBe(true)
  })
})

describe('“Sync now” (`POST /api/staff-sync/run`)', () => {
  const call = (user: unknown) =>
    staffSyncEndpoint.handler({ user, payload } as never) as Promise<Response>

  it('the district runs it, from the source set in CSI_SOURCE', async () => {
    const was = process.env.CSI_SOURCE
    process.env.CSI_SOURCE = 'mock'
    try {
      const res = await call(f.districtAdmin)
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, created: MOCK_CSI_ROWS.length })
    } finally {
      process.env.CSI_SOURCE = was
    }
  })

  it('with no source set up, it says so and changes nothing', async () => {
    const was = process.env.CSI_SOURCE
    delete process.env.CSI_SOURCE
    try {
      const res = await call(f.districtAdmin)
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ ok: false, reason: 'No CSI connection is set up yet.' })
      expect(await people()).toEqual([])
    } finally {
      if (was !== undefined) process.env.CSI_SOURCE = was
    }
  })

  it('nobody else — not a school manager, not the signed-out', async () => {
    expect((await call(f.managerA)).status).toBe(403)
    expect((await call(null)).status).toBe(403)
  })
})
