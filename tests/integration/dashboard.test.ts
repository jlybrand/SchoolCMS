import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  findFeedFailures,
  findKeyPages,
  findLastPublished,
  findRecentActivity,
  findSites,
  findUncheckedDocuments,
  findWaiting,
} from '@/admin/Dashboard/dashboard-data'
import { FEED_SYNC } from '@/collections/hooks/event-hooks'
import { CONTENT_ACTIONS, UNCHECKED_SHOWN } from '@/lib/dashboard'

import { tinyPdf, tinyPng } from '../helpers/files'
import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * The district dashboard's reads, inside real Payload and Postgres (`04` §3.1).
 *
 * What only an integration test can show: that the where clauses — a top-level "home", page
 * types, published only, the 90-day window, content actions only — mean what they say in the
 * database, and that a school manager reading them gets their own school or nothing. The
 * decisions over the results are `tests/unit/lib/dashboard.test.ts`.
 */

let payload: Payload
let f: Fixtures
const NOW = new Date()

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const mkPage = async (tenant: number, data: Record<string, unknown>) =>
  (
    await payload.create({
      collection: 'pages',
      // Shaped per call (title, slug, type, status, parent) — typed loosely for that.
      data: { tenant, visibility: 'public', ...data } as never,
      user: f.districtAdmin,
      overrideAccess: true,
    })
  ).id as number

describe('findLastPublished — when each site last went live', () => {
  it('finds a recent published change for a site that has one', async () => {
    const last = await findLastPublished(payload, f.districtAdmin, [String(f.tenantA)], NOW)
    expect(last.get(String(f.tenantA))).toEqual(expect.any(String))
  })

  it('finds nothing for a site with nothing published', async () => {
    const empty = (
      await payload.create({
        collection: 'tenants',
        data: {
          name: 'Quiet School',
          slug: `quiet-${Date.now()}`,
          hostname: `quiet-${Date.now()}.localhost`,
          type: 'school',
          status: 'active',
        },
        overrideAccess: true,
      })
    ).id
    const last = await findLastPublished(payload, f.districtAdmin, [String(empty)], NOW)
    expect(last.has(String(empty))).toBe(false)
  })

  it('ignores drafts', async () => {
    const before = await findLastPublished(payload, f.districtAdmin, [String(f.tenantB)], NOW)
    await mkPage(f.tenantB, {
      title: 'Draft only',
      slug: `draft-only-${Date.now()}`,
      _status: 'draft',
    })
    const after = await findLastPublished(payload, f.districtAdmin, [String(f.tenantB)], NOW)
    expect(after.get(String(f.tenantB))).toBe(before.get(String(f.tenantB)))
  })
})

describe('findKeyPages — each site’s front page, published', () => {
  it('finds a top-level home, and not a nested “home” or another page', async () => {
    const stamp = Date.now()
    const home = await mkPage(f.tenantA, { title: 'Home', slug: 'home', _status: 'published' })
    const other = await mkPage(f.tenantA, {
      title: 'Reach us',
      slug: `reach-${stamp}`,
      _status: 'published',
    })
    const nestedHome = await mkPage(f.tenantA, {
      title: 'Not the front page',
      slug: 'home',
      parent: other,
      _status: 'published',
    })

    const pages = await findKeyPages(
      payload,
      f.districtAdmin,
      new Map([[String(f.tenantA), 'School A']]),
    )
    const ids = pages.map((p) => p.id)
    expect(ids).toContain(home)
    expect(ids).not.toContain(other)
    expect(ids).not.toContain(nestedHome)
    expect(pages.find((p) => p.id === home)).toMatchObject({ site: 'School A', kind: 'Home page' })
  })
})

describe('findWaiting and findRecentActivity', () => {
  it('finds a submitted page with when it was sent, and which kind it is', async () => {
    await payload.update({
      collection: 'pages',
      id: f.draftPageA,
      data: { reviewState: 'submitted' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    const waiting = await findWaiting(payload, f.districtAdmin)
    expect(waiting.some((w) => typeof w.submittedAt === 'string')).toBe(true)
    // The approval cards count by kind (2026-11-12).
    expect(waiting.find((w) => w.id === f.draftPageA)?.collection).toBe('pages')
  })

  it('reads content actions only — the submit above, and no sign-ins', async () => {
    const events = await findRecentActivity(payload, f.districtAdmin, 50)
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect(CONTENT_ACTIONS as readonly unknown[]).toContain(event.action)
    }
    expect(events.some((e) => e.action === 'submit')).toBe(true)
  })
})

describe('as a school manager — their school, or nothing', () => {
  it('lists only their own site', async () => {
    expect((await findSites(payload, f.managerA)).map((s) => s.id)).toEqual([String(f.tenantA)])
  })

  it('reads no activity: the audit trail is the district’s', async () => {
    await expect(findRecentActivity(payload, f.managerA)).rejects.toThrow()
  })

  it('sees no other school’s last change', async () => {
    const last = await findLastPublished(payload, f.managerA, [String(f.tenantB)], NOW)
    expect(last.has(String(f.tenantB))).toBe(false)
  })
})

describe('findFeedFailures — feed calendars whose last copy failed (2026-11-12)', () => {
  /**
   * A feed calendar, its problem recorded as the sync job records it (the field is read-only).
   * Written AS the sync (`FEED_SYNC`), so no copy is queued: a queued job outlives this file in
   * the test database and is run by the next test that runs the jobs queue.
   */
  const asSync = { overrideAccess: true, context: { [FEED_SYNC]: true } } as const
  const feedCalendar = async (tenant: number, name: string, feedError: string | null) => {
    const made = await payload.create({
      collection: 'calendars',
      data: { tenant, name, source: 'feed', feedUrl: 'https://example.invalid/x.ics' } as never,
      ...asSync,
    })
    await payload.update({
      collection: 'calendars',
      id: made.id,
      data: { feedError } as never,
      ...asSync,
    })
    return made.id
  }
  const names = () =>
    new Map([
      [String(f.tenantA), 'School A'],
      [String(f.tenantB), 'School B'],
    ])

  it('finds a failed feed with its site and problem, and not one that copied', async () => {
    const broken = await feedCalendar(f.tenantA, 'Broken athletics', 'Could not be found.')
    const fine = await feedCalendar(f.tenantA, 'Working arts', null)
    const failures = await findFeedFailures(payload, f.districtAdmin, names())
    expect(failures).toContainEqual({
      id: broken,
      name: 'Broken athletics',
      site: 'School A',
      error: 'Could not be found.',
    })
    expect(failures.map((x) => x.id)).not.toContain(fine)
  })

  it('a school manager reads only their own site’s calendars', async () => {
    const theirs = await feedCalendar(f.tenantA, 'A broken', 'Gone.')
    const other = await feedCalendar(f.tenantB, 'B broken', 'Gone.')
    const ids = (await findFeedFailures(payload, f.managerA, names())).map((x) => x.id)
    expect(ids).toContain(theirs)
    expect(ids).not.toContain(other)
  })
})

/**
 * Documents not yet checked for accessibility (Jason, 2026-11-16; `07` §5): the district's work
 * queue — documents only, `not-attested` only, oldest first, with the total.
 */
describe('findUncheckedDocuments — the not-checked work queue', () => {
  const upload = async (tenant: number, data: Record<string, unknown>, image = false) =>
    payload.create({
      collection: 'resources',
      data: { tenant, title: 'A file', ...data } as never,
      file: image ? await tinyPng() : tinyPdf(),
      overrideAccess: true,
    })

  it('not-attested documents only, oldest first, across sites, with the total', async () => {
    const before = await findUncheckedDocuments(payload, f.districtAdmin)
    const older = await upload(f.tenantA, { title: 'Older', remediationStatus: 'not-attested' })
    const newer = await upload(f.tenantB, { title: 'Newer', remediationStatus: 'not-attested' })
    await upload(f.tenantA, { title: 'Checked', remediationStatus: 'attested' })
    await upload(f.tenantA, { title: 'Form', remediationStatus: 'not-applicable' })
    await upload(f.tenantA, { title: 'Photo', alt: 'Students' }, true)

    const after = await findUncheckedDocuments(payload, f.districtAdmin)
    expect(after.total).toBe(before.total + 2)
    expect(after.docs.length).toBeLessThanOrEqual(UNCHECKED_SHOWN)
    const titles = (await findUncheckedDocuments(payload, f.districtAdmin)).docs.map((d) => d.title)
    for (const t of ['Checked', 'Form', 'Photo']) expect(titles).not.toContain(t)
    // Oldest first: when both fit, the older one comes before the newer one.
    if (before.total + 2 <= UNCHECKED_SHOWN) {
      expect(titles.indexOf('Older')).toBeLessThan(titles.indexOf('Newer'))
    }

    // Marked checked, it leaves the queue.
    await payload.update({
      collection: 'resources',
      id: older.id,
      data: { remediationStatus: 'attested' } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect((await findUncheckedDocuments(payload, f.districtAdmin)).total).toBe(before.total + 1)
    expect(newer.id).toBeTruthy()
  })

  it('a school manager reading it gets their own school’s, or nothing', async () => {
    await upload(f.tenantB, { title: 'B’s unchecked', remediationStatus: 'not-attested' })
    const { docs } = await findUncheckedDocuments(payload, f.managerA)
    expect(docs.map((d) => d.title)).not.toContain('B’s unchecked')
  })
})
