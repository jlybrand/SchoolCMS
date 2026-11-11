import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { getTestPayload, isDenied, seed, type Fixtures } from '../helpers/payload'

/**
 * Deleting a site never deletes its content (2026-11-11).
 *
 * `plugin-multi-tenant` deletes every document of a deleted tenant by default
 * (`cleanupAfterTenantDelete`), so one mistaken delete would take a school's pages, announcements
 * and events with it, beyond any undo. That is switched off, and a site is refused deletion while
 * it still has content or staff — in words that say what to do first. An emptied site goes, and
 * takes its own setup (calendars, boards, menus, theme, settings) with it, so nothing is left
 * without a site.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

let seq = 0
const newSite = async () => {
  seq += 1
  return (
    await payload.create({
      collection: 'tenants',
      data: {
        name: `Closing School ${seq}`,
        slug: `closing-${seq}-${Date.now()}`,
        hostname: `closing-${seq}-${Date.now()}.localhost`,
        type: 'school',
        status: 'active',
      },
      overrideAccess: true,
    })
  ).id as number
}

const remove = (id: number) =>
  payload.delete({ collection: 'tenants', id, user: f.districtAdmin, overrideAccess: false })

const count = async (collection: 'pages' | 'calendars' | 'navigation', tenant: number) =>
  (
    await payload.count({
      collection,
      where: { tenant: { equals: tenant } },
      overrideAccess: true,
    })
  ).totalDocs

describe('deleting a site', () => {
  it('is refused while it has pages, announcements or events — and nothing is deleted', async () => {
    const site = await newSite()
    await payload.create({
      collection: 'pages',
      data: { tenant: site, title: 'Our history', slug: 'our-history', visibility: 'public' },
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await payload.create({
      collection: 'events',
      data: { tenant: site, title: 'Last day', start: '2027-06-01T16:00:00.000Z' },
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })

    await expect(remove(site)).rejects.toMatchObject({
      data: {
        errors: [
          {
            message:
              'Closing School 1 still has 1 page and 1 event. Delete or move them first — deleting a site never deletes its content.',
          },
        ],
      },
    })
    expect(await count('pages', site)).toBe(1)
    expect(
      await payload.findByID({ collection: 'tenants', id: site, overrideAccess: true }),
    ).toBeTruthy()
  })

  it('is refused while staff accounts are assigned to it', async () => {
    const site = await newSite()
    await payload.create({
      collection: 'users',
      data: {
        email: `staff-${seq}@test.local`,
        password: 'seed-otter-marble-91',
        name: 'Staff',
        roles: ['school-manager'],
        tenants: [{ tenant: site }],
      },
      overrideAccess: true,
    })
    await expect(remove(site)).rejects.toMatchObject({
      data: {
        errors: [{ message: expect.stringMatching(/1 staff account\b.*Remove the site from/) }],
      },
    })
  })

  it('an emptied site goes, and takes its own setup with it — nothing is left without a site', async () => {
    const site = await newSite()
    const menu = await payload.create({
      collection: 'navigation',
      data: { tenant: site, primary: [] },
      overrideAccess: true,
    })
    const { docs: calendars } = await payload.find({
      collection: 'calendars',
      where: { tenant: { equals: site } },
      overrideAccess: true,
    })
    expect(calendars).toHaveLength(1)

    await remove(site)

    const gone = async (collection: 'tenants' | 'calendars' | 'navigation', id: unknown) =>
      (await payload.findByID({
        collection,
        id: id as number,
        overrideAccess: true,
        disableErrors: true,
      })) === null
    expect(await gone('tenants', site)).toBe(true)
    // Its own calendar (the one made with it) and its menu went with it, rather than staying
    // behind with no site.
    expect(await gone('calendars', calendars[0]!.id)).toBe(true)
    expect(await gone('navigation', menu.id)).toBe(true)
  })

  it('a school manager still cannot delete a site at all', async () => {
    const site = await newSite()
    expect(
      await isDenied(() =>
        payload.delete({
          collection: 'tenants',
          id: site,
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
  })

  it('a seeded school with its pages is refused — the cascade is off', async () => {
    expect(await isDenied(() => remove(f.tenantA))).toBe(true)
    expect(await count('pages', f.tenantA)).toBeGreaterThan(0)
  })
})
