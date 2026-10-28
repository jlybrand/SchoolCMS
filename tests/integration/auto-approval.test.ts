import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { findGrantHolders, findRecentAutoApprovals } from '@/admin/Grants/grant-data'

import { getTestPayload, isDenied, seed, type Fixtures } from '../helpers/payload'

/**
 * Auto-approval grants against the real stack (`04` §4.3, `06` §2.2).
 *
 * `tests/unit/access/auto-approval.test.ts` owns the decision. This proves what holding a grant
 * does: to a page, nothing — no scope covers pages, so a manager holding EVERY grant still queues.
 * To an announcement, `posts.routine` publishes it at once when nothing on the never list is
 * touched (the block at the end). And only the district can issue one.
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

/**
 * ============================================================================
 * `posts.routine` ACTS (Jason, 2026-10-28) — against the real stack.
 * ============================================================================
 *
 * A school manager holding the grant sends an announcement; if nothing on the never list is
 * touched it publishes at once, in the same transaction, and the trail says so. Anything else
 * waits in the queue exactly as before.
 */
describe('posts.routine', () => {
  const words = (text: string) =>
    ({
      root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] },
    }) as never

  let seq = 0
  /** Created and SENT in one write by the manager, as the school's form does on a quick post. */
  const send = async (extra: Record<string, unknown> = {}) => {
    seq += 1
    return payload.create({
      collection: 'posts',
      data: {
        tenant: f.tenantA,
        board: f.boardA,
        title: `Picture day ${seq}`,
        visibility: 'public',
        body: words('Thursday, in the gym.'),
        reviewState: 'submitted',
        ...extra,
      } as never,
      draft: true,
      user: await managerWithGrants(),
      overrideAccess: false,
    })
  }
  const live = (id: number) =>
    payload.findByID({ collection: 'posts', id, draft: false, depth: 0, overrideAccess: true })
  const trail = async (id: number) =>
    (
      await payload.find({
        collection: 'audit-events',
        where: {
          and: [{ contentType: { equals: 'posts' } }, { documentId: { equals: String(id) } }],
        },
        sort: 'createdAt',
        overrideAccess: true,
      })
    ).docs

  beforeAll(async () => {
    await grant(['posts.routine'])
  })

  it('a new announcement sent under the grant is live at once — dated, nothing pending', async () => {
    const sent = await send()
    expect(sent._status).toBe('published')
    const doc = await live(sent.id)
    expect(doc._status).toBe('published')
    expect(doc.reviewState ?? null).toBeNull()
    expect(doc.publishedDate).toBeTruthy()
  })

  it('the trail records the send and the auto-approval — flagged, by the sender, naming the grant', async () => {
    const sent = await send()
    const entries = await trail(sent.id)
    expect(entries.map((e) => e.action)).toEqual(['submit', 'auto-approve'])
    expect(entries[1]).toMatchObject({
      autoApproved: true,
      actorLabel: f.managerA.email,
      summary: 'Under the grant “Posts: routine posts”',
    })
  })

  it('emails nobody — there was no reviewer', async () => {
    const spy = vi.spyOn(payload, 'sendEmail').mockResolvedValue(undefined)
    try {
      await send()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('an edit to a live announcement’s words, sent under the grant, is live at once', async () => {
    const sent = await send()
    await payload.update({
      collection: 'posts',
      id: sent.id,
      data: { body: words('Friday, in the gym.'), reviewState: 'submitted' } as never,
      draft: true,
      user: await managerWithGrants(),
      overrideAccess: false,
    })
    expect(JSON.stringify((await live(sent.id)).body)).toContain('Friday')
  })

  it.each([['staff only', { visibility: 'staff' }]])(
    'a new announcement that is %s waits in the queue',
    async (_label, extra) => {
      const sent = await send(extra)
      expect(sent._status).toBe('draft')
      expect(sent.reviewState).toBe('submitted')
      expect((await trail(sent.id)).map((e) => e.action)).toEqual(['submit'])
    },
  )

  it('moving a live announcement to a new address waits in the queue', async () => {
    const sent = await send()
    const moved = await payload.update({
      collection: 'posts',
      id: sent.id,
      data: { slug: `moved-${seq}`, reviewState: 'submitted' } as never,
      draft: true,
      user: await managerWithGrants(),
      overrideAccess: false,
    })
    expect(moved.reviewState).toBe('submitted')
    expect((await live(sent.id)).slug).not.toBe(`moved-${seq}`)
  })

  it('an announcement the district flagged for translation review waits in the queue', async () => {
    const sent = await send()
    await payload.update({
      collection: 'posts',
      id: sent.id,
      data: { requiresTranslationReview: true, _status: 'published' },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const resent = await payload.update({
      collection: 'posts',
      id: sent.id,
      data: { body: words('Changed.'), reviewState: 'submitted' } as never,
      draft: true,
      user: await managerWithGrants(),
      overrideAccess: false,
    })
    expect(resent.reviewState).toBe('submitted')
  })

  it('a save that is not a send publishes nothing, grant or no grant', async () => {
    const saved = await payload.create({
      collection: 'posts',
      data: {
        tenant: f.tenantA,
        board: f.boardA,
        title: 'Still writing',
        visibility: 'public',
        body: words('Draft.'),
      } as never,
      draft: true,
      user: await managerWithGrants(),
      overrideAccess: false,
    })
    expect(saved._status).toBe('draft')
  })

  it('the grant does not let a school manager publish directly', async () => {
    const user = await managerWithGrants()
    expect(
      await isDenied(() =>
        payload.create({
          collection: 'posts',
          data: {
            tenant: f.tenantA,
            board: f.boardA,
            title: 'Direct',
            visibility: 'public',
            body: words('x'),
            _status: 'published',
          } as never,
          user,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
  })

  it('the district’s 30-day spot-check list shows it; a school manager reads none of it', async () => {
    const sent = await send()
    const forDistrict = await findRecentAutoApprovals(payload, f.districtAdmin)
    expect(forDistrict.map((e) => e.documentId)).toContain(String(sent.id))
    expect(
      await isDenied(() => findRecentAutoApprovals(payload, f.managerA)).then(
        async (denied) =>
          denied || (await findRecentAutoApprovals(payload, f.managerA)).length === 0,
      ),
    ).toBe(true)
  })

  it('with the grant revoked, the same announcement waits', async () => {
    await grant([])
    try {
      const sent = await send()
      expect(sent._status).toBe('draft')
      expect(sent.reviewState).toBe('submitted')
    } finally {
      await grant(['posts.routine'])
    }
  })
})
