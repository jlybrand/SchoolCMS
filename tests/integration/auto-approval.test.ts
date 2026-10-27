import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { findGrantHolders } from '@/admin/Grants/grant-data'

import { getTestPayload, isDenied, seed, type Fixtures } from '../helpers/payload'

/**
 * Auto-approval grants against the real stack (`04` §4.3, `06` §2.2).
 *
 * `tests/unit/access/auto-approval.test.ts` owns the decision. This proves what holding a grant
 * does to a page today — nothing: no scope covers pages, so a manager holding EVERY grant still
 * queues, on create and on a change to a live page. And that only the district can issue one.
 */

let payload: Payload
let f: Fixtures

const grant = (autoApprove: string[]) =>
  payload.update({
    collection: 'users',
    id: f.managerA.id,
    data: { autoApprove } as never,
    user: f.districtAdmin,
    overrideAccess: false,
  })

/** The manager as a request would carry them — with the grant on the user document. */
const managerWithGrants = async () =>
  payload.findByID({ collection: 'users', id: f.managerA.id, depth: 0, overrideAccess: true })

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
  await grant(['events.schedule', 'posts.routine'])
}, 120_000)

afterAll(async () => {
  await grant([])
})

const latest = (id: number) =>
  payload.findByID({ collection: 'pages', id, draft: true, depth: 0, overrideAccess: true })

describe('holding every grant, a page still queues', () => {
  it('a new page sent for approval waits as a draft', async () => {
    const user = await managerWithGrants()
    expect(user.autoApprove).toEqual(['events.schedule', 'posts.routine'])

    const page = await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantA,
        title: 'Granted but queued',
        slug: 'granted-but-queued',
        pageType: 'standard',
        visibility: 'public',
        reviewState: 'submitted',
      },
      draft: true,
      user,
      overrideAccess: false,
    })

    const stored = await latest(page.id)
    expect(stored._status).toBe('draft')
    expect(stored.reviewState).toBe('submitted')
  })

  it('a change to a live page waits, and the live page is untouched', async () => {
    const user = await managerWithGrants()
    const before = await payload.findByID({
      collection: 'pages',
      id: f.publishedPageA,
      draft: false,
      overrideAccess: true,
    })

    await payload.update({
      collection: 'pages',
      id: f.publishedPageA,
      data: { title: 'A routine retitle', reviewState: 'submitted' },
      draft: true,
      user,
      overrideAccess: false,
    })

    const live = await payload.findByID({
      collection: 'pages',
      id: f.publishedPageA,
      draft: false,
      overrideAccess: true,
    })
    expect(live.title).toBe(before.title)
    expect((await latest(f.publishedPageA)).reviewState).toBe('submitted')
  })

  it('a publishing write is refused, grant or no grant', async () => {
    const user = await managerWithGrants()
    const denied = await isDenied(() =>
      payload.update({
        collection: 'pages',
        id: f.publishedPageA,
        data: { title: 'Straight to live', _status: 'published' },
        user,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })
})

describe('who can issue a grant', () => {
  it('a school manager cannot grant one to a colleague', async () => {
    const denied = await isDenied(() =>
      payload.update({
        collection: 'users',
        id: f.managerB.id,
        data: { autoApprove: ['posts.routine'] } as never,
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
    const b = await payload.findByID({
      collection: 'users',
      id: f.managerB.id,
      overrideAccess: true,
    })
    expect(b.autoApprove ?? []).toEqual([])
  })

  it('an unknown scope is refused at the field', async () => {
    const denied = await isDenied(() => grant(['everything']))
    expect(denied).toBe(true)
  })
})

describe('the dashboard list of holders', () => {
  it('finds the manager holding grants, and only holders', async () => {
    const holders = await findGrantHolders(payload, f.districtAdmin)
    expect(holders.map((u) => u.id)).toEqual([f.managerA.id])
  })

  it('reads as the viewer: a school manager sees at most themselves', async () => {
    const holders = await findGrantHolders(payload, f.managerB)
    expect(holders).toEqual([])
  })
})
