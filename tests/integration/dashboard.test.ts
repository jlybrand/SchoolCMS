import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  findKeyPages,
  findLastPublished,
  findRecentActivity,
  findSites,
  findWaiting,
} from '@/admin/Dashboard/dashboard-data'
import { CONTENT_ACTIONS } from '@/lib/dashboard'

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
  it('finds a submitted page with when it was sent', async () => {
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
