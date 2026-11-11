import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { getTestPayload, isDenied, mainCalendarFor, seed, type Fixtures } from '../helpers/payload'

/**
 * Calendars and events over the real stack (Jason, 2026-10-28 and 2026-11-11) — the hooks the
 * unit suites cannot reach. Isolation and the publish gate are in tenant-isolation.test.ts.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const draft = (data: Record<string, unknown>, user = f.districtAdmin) =>
  payload.create({
    collection: 'events',
    data: { start: '2026-12-04T23:00:00.000Z', ...data } as never,
    draft: true,
    user,
    overrideAccess: false,
  })

describe('each site’s own calendar', () => {
  it('is made with the site, named after it, and labelled for the district', async () => {
    const site = await payload.create({
      collection: 'tenants',
      data: {
        name: 'School C',
        slug: 'school-c',
        hostname: 'c.localhost',
        type: 'school',
        status: 'active',
      },
      overrideAccess: true,
    })
    const id = await mainCalendarFor(payload, site.id as number)
    const calendar = await payload.findByID({ collection: 'calendars', id, overrideAccess: true })
    expect(calendar).toMatchObject({ name: 'School C', isMain: true, label: 'School C' })
  })

  it('a second calendar is labelled "Site · Calendar"', async () => {
    const calendar = await payload.create({
      collection: 'calendars',
      data: { tenant: f.districtTenant, name: 'District HS' },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(calendar).toMatchObject({ label: 'District · District HS', isMain: false })
  })

  it('cannot be made "main" by anyone through the API', async () => {
    const calendar = await payload.create({
      collection: 'calendars',
      data: { tenant: f.tenantA, name: 'Pretender', isMain: true },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(calendar.isMain).toBe(false)
  })

  it('cannot be deleted; another calendar can', async () => {
    const main = await mainCalendarFor(payload, f.tenantB)
    expect(
      await isDenied(() =>
        payload.delete({
          collection: 'calendars',
          id: main,
          user: f.districtAdmin,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
    const other = await payload.create({
      collection: 'calendars',
      data: { tenant: f.tenantB, name: 'Testing' },
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'calendars',
      id: other.id,
      user: f.districtAdmin,
      overrideAccess: false,
    })
  })
})

describe('an event', () => {
  it('sent with no calendar goes on the site’s own', async () => {
    const made = await draft({ tenant: f.tenantA, title: 'No calendar chosen' }, f.managerA)
    const calendar = made.calendar as { id: number } | number
    expect(typeof calendar === 'object' ? calendar.id : calendar).toBe(
      await mainCalendarFor(payload, f.tenantA),
    )
  })

  it('refuses an end before the start, in words, on the field', async () => {
    await expect(
      draft({ tenant: f.tenantA, title: 'Backwards', end: '2026-12-04T22:00:00.000Z' }),
    ).rejects.toMatchObject({
      data: { errors: [{ path: 'end', message: 'The end can’t be before the start.' }] },
    })
  })

  it('refuses a repeat with no last date', async () => {
    await expect(
      draft({ tenant: f.tenantA, title: 'Forever', repeat: 'weekly' }),
    ).rejects.toMatchObject({
      data: { errors: [{ path: 'repeatUntil', message: 'Choose the last date it repeats on.' }] },
    })
  })

  it('stores a repeat with its last date', async () => {
    const made = await draft({
      tenant: f.tenantA,
      title: 'Tuesdays',
      repeat: 'weekly',
      repeatUntil: '2027-05-31T12:00:00.000Z',
    })
    expect(made).toMatchObject({ repeat: 'weekly' })
  })

  it('a district publish writes the trail entry', async () => {
    const made = await payload.create({
      collection: 'events',
      data: {
        tenant: f.tenantA,
        title: 'Published by the district',
        start: '2026-12-04T23:00:00.000Z',
        _status: 'published',
      },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const { docs } = await payload.find({
      collection: 'audit-events',
      where: {
        and: [{ contentType: { equals: 'events' } }, { documentId: { equals: String(made.id) } }],
      },
      overrideAccess: true,
    })
    expect(docs.map((d) => d.action)).toEqual(['publish'])
  })
})
