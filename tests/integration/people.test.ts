import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * Staff directories over the real stack (Jason, 2026-11-13): every staff member comes from CSI
 * — the sync alone creates one, and writes what comes from CSI; the district edits only the
 * dashboard's own fields (the sort name) and the sub-groups inside a school's group, from that
 * school's staff. Schools neither read nor write.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

/** A refusal, by its words: Payload keeps each field's message in the error's data. */
const refusal = async (attempt: Promise<unknown>): Promise<string> => {
  try {
    await attempt
  } catch (err) {
    return JSON.stringify((err as { data?: unknown }).data ?? (err as Error).message)
  }
  throw new Error('expected a refusal; the write went through')
}

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const asSync = <T extends 'people' | 'staff-groups'>(
  collection: T,
  data: Record<string, unknown>,
) => payload.create({ collection, data: data as never, user: f.systemSync, overrideAccess: false })

const asDistrict = <T extends 'people' | 'staff-groups'>(
  collection: T,
  data: Record<string, unknown>,
) =>
  payload.create({ collection, data: data as never, user: f.districtAdmin, overrideAccess: false })

const school = (name = 'SHS') => asSync('staff-groups', { name, csiLocationId: unique() })

const person = (group: number | string, name = 'Jane Smith') =>
  asSync('people', {
    name,
    title: 'Teacher',
    email: `${unique()}@ddtwo.org`,
    csiId: unique(),
    group,
  })

const readPerson = (id: number | string) =>
  payload.findByID({ collection: 'people', id, overrideAccess: true, depth: 0 })
const readGroup = (id: number | string) =>
  payload.findByID({ collection: 'staff-groups', id, overrideAccess: true, depth: 0 })

describe('staff come from CSI', () => {
  it('the sync creates a staff member', async () => {
    const shs = await school()
    const doc = await person(shs.id)
    expect(await readPerson(doc.id)).toMatchObject({ name: 'Jane Smith', title: 'Teacher' })
  })

  it('the district cannot add one in the dashboard (Jason)', async () => {
    await expect(asDistrict('people', { name: 'Pat Doe' })).rejects.toThrow()
  })

  it('their CSI fields are read-only to the district — they change in CSI', async () => {
    const shs = await school()
    const doc = await person(shs.id)
    await payload.update({
      collection: 'people',
      id: doc.id,
      data: { name: 'Someone Else', title: 'Principal', active: false } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(await readPerson(doc.id)).toMatchObject({
      name: 'Jane Smith',
      title: 'Teacher',
      active: true,
    })
  })

  it('the sync cannot delete — a departure is hidden, not removed', async () => {
    const doc = await person((await school()).id)
    await expect(
      payload.delete({
        collection: 'people',
        id: doc.id,
        user: f.systemSync,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})

describe('schools are kept out', () => {
  it('a school manager neither reads nor writes; nor does anyone signed out', async () => {
    for (const collection of ['people', 'staff-groups'] as const) {
      await expect(
        payload.find({ collection, user: f.managerA, overrideAccess: false }),
      ).rejects.toThrow()
      await expect(payload.find({ collection, overrideAccess: false })).rejects.toThrow()
    }
    await expect(
      payload.create({
        collection: 'staff-groups',
        data: { name: 'Sneaky' } as never,
        user: f.managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})

describe('the sort name', () => {
  it('the district’s override reorders a person; the sync cannot set one', async () => {
    const doc = await person((await school()).id, 'Maria de la Cruz')
    expect((await readPerson(doc.id)).sortKey).toBe('cruz maria de la')

    await payload.update({
      collection: 'people',
      id: doc.id,
      data: { sortName: 'de la Cruz, Maria' } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect((await readPerson(doc.id)).sortKey).toBe('de la cruz, maria')

    await payload.update({
      collection: 'people',
      id: doc.id,
      data: { sortName: 'Zzz', title: 'Teacher of the year' } as never,
      user: f.systemSync,
      overrideAccess: false,
    })
    expect(await readPerson(doc.id)).toMatchObject({
      sortName: 'de la Cruz, Maria',
      sortKey: 'de la cruz, maria',
      title: 'Teacher of the year',
    })
  })
})

describe('a school’s group', () => {
  it('is made and named by the sync; the district cannot rename or delete it', async () => {
    const shs = await school('Southside High')
    await payload.update({
      collection: 'staff-groups',
      id: shs.id,
      data: { name: 'Renamed' } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(await readGroup(shs.id)).toMatchObject({
      name: 'Southside High',
      label: 'Southside High',
    })
    await expect(
      payload.delete({
        collection: 'staff-groups',
        id: shs.id,
        user: f.districtAdmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('takes no members of its own — everyone at the school is in it', async () => {
    const shs = await school()
    const jane = await person(shs.id)
    expect(
      await refusal(
        payload.update({
          collection: 'staff-groups',
          id: shs.id,
          data: { members: [jane.id] } as never,
          user: f.districtAdmin,
          overrideAccess: false,
        }),
      ),
    ).toContain('Tick people in a sub-group.')
  })

  it('the district cannot make one — a school’s group comes from CSI', async () => {
    expect(await refusal(asDistrict('staff-groups', { name: 'New school' }))).toContain(
      'Choose the school this group belongs to.',
    )
    // Claiming a CSI location does not make it one: that field is the sync's alone.
    expect(
      await refusal(asDistrict('staff-groups', { name: 'Fake school', csiLocationId: unique() })),
    ).toContain('Choose the school this group belongs to.')
  })
})

describe('sub-groups', () => {
  it('the district makes one in a school’s group, ticks its staff, renames and deletes it', async () => {
    const shs = await school('SHS')
    const jane = await person(shs.id, 'Jane Smith')
    const ann = await person(shs.id, 'Ann Lee')
    const nurses = await asDistrict('staff-groups', {
      name: 'Nurses',
      parent: shs.id,
      members: [jane.id, ann.id],
    })
    expect(await readGroup(nurses.id)).toMatchObject({
      label: 'SHS › Nurses',
      members: [jane.id, ann.id],
    })

    await payload.update({
      collection: 'staff-groups',
      id: nurses.id,
      data: { name: 'School nurses', members: [ann.id] } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(await readGroup(nurses.id)).toMatchObject({
      label: 'SHS › School nurses',
      members: [ann.id],
    })

    await payload.delete({
      collection: 'staff-groups',
      id: nurses.id,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    // The school's group and its staff are untouched.
    expect((await readPerson(jane.id)).id).toBe(jane.id)
    expect((await readGroup(shs.id)).id).toBe(shs.id)
  })

  it('refuses someone from another school, by name', async () => {
    const shs = await school('SHS')
    const ams = await school('AMS')
    const bo = await person(ams.id, 'Bo Diaz')
    expect(
      await refusal(
        asDistrict('staff-groups', { name: 'Counselors', parent: shs.id, members: [bo.id] }),
      ),
    ).toContain('Bo Diaz isn’t at SHS.')
  })

  it('goes one level deep', async () => {
    const shs = await school()
    const nurses = await asDistrict('staff-groups', { name: 'Nurses', parent: shs.id })
    expect(
      await refusal(asDistrict('staff-groups', { name: 'Night nurses', parent: nurses.id })),
    ).toContain('Groups go one level deep.')
  })

  it('the sync never touches who is in one', async () => {
    const shs = await school()
    const jane = await person(shs.id)
    const nurses = await asDistrict('staff-groups', {
      name: 'Nurses',
      parent: shs.id,
      members: [jane.id],
    })
    await payload.update({
      collection: 'staff-groups',
      id: nurses.id,
      data: { members: [], name: 'Changed by sync' } as never,
      user: f.systemSync,
      overrideAccess: false,
    })
    expect(await readGroup(nurses.id)).toMatchObject({
      name: 'Nurses',
      members: [jane.id],
    })
  })
})
