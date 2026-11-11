import { createLocalReq, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { listMyCalendars } from '@/admin/SchoolPlane/school-data'
import { ensureMainCalendars } from '@/collections/hooks/event-hooks'
import { getCalendarFeed } from '@/content/events'
import { resolvePageBlocks } from '@/content/resolve-blocks'
import type { CalendarBlock, ContentContext, ResolvedCalendarBlock } from '@/content/types'

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

  it('the backfill gives a site made before calendars its own, once', async () => {
    const main = await mainCalendarFor(payload, f.tenantA)
    await payload.db.deleteOne({ collection: 'calendars', where: { id: { equals: main } } })
    expect(await ensureMainCalendars(payload)).toEqual(['school-a'])
    expect(await ensureMainCalendars(payload)).toEqual([])
    const again = await payload.findByID({
      collection: 'calendars',
      id: await mainCalendarFor(payload, f.tenantA),
      overrideAccess: true,
    })
    expect(again).toMatchObject({ name: 'School A', isMain: true })
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

describe('a calendar block, resolved (Jason, 2026-11-11)', () => {
  const ctx = (): ContentContext => ({
    tenant: {
      id: String(f.tenantB),
      slug: 'b',
      name: 'School B',
      hostname: 'b.localhost',
      type: 'school',
    },
    locale: 'en',
  })
  const block = (overrides: Partial<CalendarBlock>): CalendarBlock => ({
    kind: 'calendar',
    id: 'cal',
    heading: 'Upcoming events',
    calendars: [],
    display: 'list',
    limit: 5,
    ...overrides,
  })
  const resolve = async (b: CalendarBlock) =>
    (await resolvePageBlocks(ctx(), [b], {
      serverUrl: 'http://localhost:3000',
      today: '2027-03-01',
    })) as ResolvedCalendarBlock[]

  let calendar: string

  beforeAll(async () => {
    calendar = String(await mainCalendarFor(payload, f.tenantB))
    const mk = (title: string, start: string, extra: Record<string, unknown> = {}) =>
      payload.create({
        collection: 'events',
        data: {
          tenant: f.tenantB,
          calendar: Number(calendar),
          title,
          start,
          _status: 'published',
          ...extra,
        } as never,
        user: f.districtAdmin,
        overrideAccess: false,
      })
    await mk('Past event', '2027-02-10T23:00:00.000Z')
    await mk('Spring concert', '2027-03-12T23:00:00.000Z', {
      notes: {
        root: {
          type: 'root',
          children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Doors at 5.' }] }],
        },
      },
    })
    await mk('Board meeting', '2027-03-02T23:00:00.000Z', {
      repeat: 'monthly',
      repeatUntil: '2027-06-02T12:00:00.000Z',
    })
  })

  it('a list is the next events from today, at most its number, with their notes', async () => {
    const [list] = await resolve(block({ calendars: [calendar], limit: 3 }))
    expect(list?.display).toBe('list')
    if (list?.display !== 'list') return
    expect(list.events.map((e) => [e.title, e.startDate])).toEqual([
      ['Board meeting', '2027-03-02'],
      ['Spring concert', '2027-03-12'],
      ['Board meeting', '2027-04-02'],
    ])
    expect(list.events[1]!.notes).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Doors at 5.', marks: [] }] },
    ])
  })

  it('names each calendar shown with its webcal feed on its own site', async () => {
    const district = String(await mainCalendarFor(payload, f.districtTenant))
    const [list] = await resolve(block({ calendars: [calendar, district] }))
    expect(list?.subscribe).toEqual([
      { name: 'School B', href: `webcal://b.localhost:3000/calendars/${calendar}.ics` },
      { name: 'District', href: `webcal://localhost:3000/calendars/${district}.ics` },
    ])
  })

  it('an empty list is dropped — no heading over nothing', async () => {
    const other = String(await mainCalendarFor(payload, f.tenantA))
    expect(await resolve(block({ calendars: [other] }))).toEqual([])
  })

  it('a grid is twelve months from this one, each day holding its events', async () => {
    const [grid] = await resolve(block({ calendars: [calendar], display: 'grid' }))
    expect(grid?.display).toBe('grid')
    if (grid?.display !== 'grid') return
    expect(grid.months).toHaveLength(12)
    expect(grid.months[0]!.label).toBe('March 2027')
    const day12 = grid.months[0]!.weeks.flat().find((d) => d?.date === '2027-03-12')
    const concert = grid.events.find((e) => e.title === 'Spring concert')!
    expect(day12?.eventKeys).toEqual([concert.key])
    expect(grid.months[0]!.weeks.flat().find((d) => d?.date === '2027-03-01')?.isToday).toBe(true)
  })

  it('an empty grid still shows — an empty month is a calendar', async () => {
    const other = String(await mainCalendarFor(payload, f.tenantA))
    const [grid] = await resolve(block({ calendars: [other], display: 'grid' }))
    expect(grid?.display).toBe('grid')
  })
})

describe('the school plane’s reads (Jason, 2026-11-11)', () => {
  it('the calendars offered are the manager’s own school’s, by name', async () => {
    const calendars = await listMyCalendars(await createLocalReq({ user: f.managerA }, payload))
    // Only School A's — its own among them (an earlier test here adds a second one).
    expect(calendars.every((c) => c.tenant === f.tenantA)).toBe(true)
    expect(calendars.map((c) => c.label)).toContain('School A')
  })
})

describe('a calendar’s iCal feed (Jason, 2026-11-11)', () => {
  const site = (tenant: number, hostname: string) => ({
    id: String(tenant),
    slug: hostname,
    name: hostname,
    hostname,
    type: 'school' as const,
  })

  it('has the calendar’s published events, and never a draft', async () => {
    const calendar = String(await mainCalendarFor(payload, f.tenantB))
    await payload.create({
      collection: 'events',
      data: { tenant: f.tenantB, title: 'Feed draft', start: '2027-03-20T23:00:00.000Z' } as never,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const feed = await getCalendarFeed(site(f.tenantB, 'b.localhost'), calendar, '2027-03-01')
    expect(feed?.name).toBe('School B')
    const titles = feed?.events.map((e) => e.title) ?? []
    expect(titles).toContain('Spring concert')
    expect(titles).not.toContain('Feed draft')
  })

  it('is served only on the calendar’s own site — another site’s id is not found', async () => {
    const calendarB = String(await mainCalendarFor(payload, f.tenantB))
    expect(
      await getCalendarFeed(site(f.tenantA, 'a.localhost'), calendarB, '2027-03-01'),
    ).toBeNull()
    expect(await getCalendarFeed(site(f.tenantB, 'b.localhost'), '999999', '2027-03-01')).toBeNull()
  })
})
