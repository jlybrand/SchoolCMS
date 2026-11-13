import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { listStaff } from '@/content/people'

import { getTestPayload, seed } from '../helpers/payload'

/**
 * What a staff list shows (Jason, 2026-11-13): a school's group lists everyone at the school; a
 * sub-group lists the people ticked in it who are still there. Hidden staff (gone from CSI) never
 * show. A–Z by last name. Only what the page shows leaves the content layer — name, title, email.
 */

let payload: Payload
let shs: number | string
let nurses: number | string
let ams: number | string

beforeAll(async () => {
  payload = await getTestPayload()
  await seed(payload)
  const group = (data: Record<string, unknown>) =>
    payload.create({ collection: 'staff-groups', data: data as never, overrideAccess: true })
  const person = (name: string, title: string, school: number | string, active = true) =>
    payload.create({
      collection: 'people',
      data: {
        name,
        title,
        email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.org`,
        csiId: `T-${name}`,
        group: school,
        active,
      } as never,
      overrideAccess: true,
    })
  shs = (await group({ name: 'SHS', csiLocationId: 'T-SHS' })).id
  ams = (await group({ name: 'AMS', csiLocationId: 'T-AMS' })).id
  const jane = await person('Jane Smith', 'Nurse', shs)
  await person('Adam Smith', 'Teacher', shs)
  await person('Maria de la Cruz', 'Counselor', shs)
  const gone = await person('Gone Away', 'Nurse', shs, false)
  await person('Bo Diaz', 'Teacher', ams)
  nurses = (await group({ name: 'Nurses', parent: shs, members: [jane.id, gone.id] })).id
}, 120_000)

describe('listStaff', () => {
  it('a school’s group: everyone there, A–Z by last name, nobody hidden', async () => {
    const staff = await listStaff(String(shs))
    expect(staff.map((p) => p.name)).toEqual(['Maria de la Cruz', 'Adam Smith', 'Jane Smith'])
  })

  it('a sub-group: the people ticked in it, still shown', async () => {
    expect((await listStaff(String(nurses))).map((p) => p.name)).toEqual(['Jane Smith'])
  })

  it('only what the page shows', async () => {
    const [maria] = await listStaff(String(shs))
    expect(maria).toEqual({
      id: expect.any(String),
      name: 'Maria de la Cruz',
      title: 'Counselor',
      email: 'maria.de.la.cruz@example.org',
    })
  })

  it('another school’s staff never appear; an unknown group lists nobody', async () => {
    expect((await listStaff(String(ams))).map((p) => p.name)).toEqual(['Bo Diaz'])
    expect(await listStaff('999999')).toEqual([])
  })
})
