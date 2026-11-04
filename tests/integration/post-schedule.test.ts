import { createLocalReq, type Payload, type TypedUser } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { approveDocument, latestVersionToken } from '@/collections/endpoints/approve'
import { runPostSchedule } from '@/collections/endpoints/post-schedule'
import { SCHEDULED_RUN } from '@/collections/hooks/post-dates'
import { checkPostDates } from '@/lib/post-dates'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * An announcement's dates over the real stack (Jason, 2026-11-04): approve for later, go live at
 * the Start, come down at Expires — and nothing a school did not get approved goes live by
 * waiting. The rules alone are `tests/unit/lib/post-dates.test.ts` and `review-state.test.ts`.
 *
 * The schedule sweep is called with a chosen `now`, so "later" is minutes, not a wait.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const HOUR = 60 * 60 * 1000
const inHours = (h: number) => new Date(Date.now() + h * HOUR)
const asUser = (user: TypedUser) => createLocalReq({ user }, payload)
const system = () => createLocalReq({}, payload)

const BODY = {
  root: {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Words.' }] }],
  },
}

const live = (id: number | string) =>
  payload.findByID({ collection: 'posts', id, draft: false, depth: 0, overrideAccess: true })
const latest = (id: number | string) =>
  payload.findByID({ collection: 'posts', id, draft: true, depth: 0, overrideAccess: true })

let seq = 0
/** A post on School A's board, written and sent for approval by School A's manager. */
const sentPost = async (title = 'Picture day') => {
  seq += 1
  const post = await payload.create({
    collection: 'posts',
    data: {
      tenant: f.tenantA,
      board: f.boardA,
      title: `${title} ${seq}`,
      body: BODY,
      visibility: 'public',
      reviewState: 'submitted',
    } as never,
    draft: true,
    user: f.managerA,
    overrideAccess: false,
  })
  return post.id
}

const approve = async (id: number | string, dates: Parameters<typeof checkPostDates>[0]) => {
  const check = checkPostDates(dates, new Date())
  if (!check.ok) throw new Error(JSON.stringify(check.errors))
  return approveDocument(
    await asUser(f.districtAdmin),
    'posts',
    id,
    await latestVersionToken(payload, 'posts', id),
    check,
  )
}

describe('approving with a future Start schedules', () => {
  it('keeps it off the website, out of the queue, and records when it goes live', async () => {
    const id = await sentPost()
    const start = inHours(24)
    expect(await approve(id, { publishAt: start.toISOString() })).toEqual({ ok: true })

    const doc = await latest(id)
    expect(doc.reviewState).toBe('scheduled')
    expect(doc._status).toBe('draft')
    expect(new Date(doc.publishAt as string).toISOString()).toBe(start.toISOString())
    expect((await live(id))._status).not.toBe('published')

    const { totalDocs } = await payload.count({
      collection: 'audit-events',
      where: { and: [{ documentId: { equals: String(id) } }, { action: { equals: 'schedule' } }] },
      overrideAccess: true,
    })
    expect(totalDocs).toBe(1)
  })

  it('goes live when the sweep runs at its time — and not before', async () => {
    const id = await sentPost()
    const start = inHours(2)
    await approve(id, { publishAt: start.toISOString() })

    await runPostSchedule(await system(), inHours(1))
    expect((await live(id))._status).not.toBe('published')

    const run = await runPostSchedule(await system(), inHours(3))
    expect(run.published).toContain(String(id))
    const doc = await live(id)
    expect(doc._status).toBe('published')
    expect(doc.reviewState ?? null).toBeNull()
    expect(doc.publishedDate).toBeTruthy()
  })

  it('a school’s edit after approval drops it: their new words are not published by waiting', async () => {
    const id = await sentPost()
    await approve(id, { publishAt: inHours(2).toISOString() })
    await payload.update({
      collection: 'posts',
      id,
      data: { title: 'Changed after approval' } as never,
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    expect((await latest(id)).reviewState).toBe('editing')

    const run = await runPostSchedule(await system(), inHours(3))
    expect(run.published).not.toContain(String(id))
    expect((await live(id))._status).not.toBe('published')
  })

  it('a school manager never sees the dates — their form cannot carry one back', async () => {
    const id = await sentPost()
    await approve(id, { publishAt: inHours(2).toISOString() })
    const seen = await payload.findByID({
      collection: 'posts',
      id,
      draft: true,
      depth: 0,
      user: f.managerA,
      overrideAccess: false,
    })
    expect(seen).not.toHaveProperty('publishAt')
    expect(seen).not.toHaveProperty('expiresAt')
    expect(seen).not.toHaveProperty('featuredUntil')
  })

  it('a school manager cannot set a Start, by any route', async () => {
    const id = await sentPost()
    await expect(
      payload.update({
        collection: 'posts',
        id,
        data: { publishAt: inHours(5).toISOString() } as never,
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})

describe('the district’s own form', () => {
  it('publishing a new post with a future Start schedules it instead', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: {
        tenant: f.tenantA,
        board: f.boardA,
        title: `District scheduled ${Date.now()}`,
        body: BODY,
        visibility: 'public',
        publishAt: inHours(6).toISOString(),
        _status: 'published',
      } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect((await live(post.id))._status).toBe('draft')
    expect((await latest(post.id)).reviewState).toBe('scheduled')
  })

  it('a Start on a post already live is refused, with the way out', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: {
        tenant: f.tenantA,
        board: f.boardA,
        title: `Already live ${Date.now()}`,
        body: BODY,
        visibility: 'public',
        _status: 'published',
      } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await expect(
      payload.update({
        collection: 'posts',
        id: post.id,
        data: { publishAt: inHours(6).toISOString(), _status: 'published' } as never,
        user: f.districtAdmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/publishAt/)
    expect((await live(post.id))._status).toBe('published')
  })
})

describe('Expires', () => {
  it('takes it off the website at its time — unpublished, not deleted — and records it', async () => {
    const id = await sentPost()
    const expires = inHours(5)
    await approve(id, { expiresAt: expires.toISOString() })
    expect((await live(id))._status).toBe('published')

    await runPostSchedule(await system(), inHours(4))
    expect((await live(id))._status).toBe('published')

    const run = await runPostSchedule(await system(), inHours(6))
    expect(run.expired).toContain(String(id))
    expect((await live(id))._status).toBe('draft')
    const { totalDocs } = await payload.count({
      collection: 'audit-events',
      where: { and: [{ documentId: { equals: String(id) } }, { action: { equals: 'expire' } }] },
      overrideAccess: true,
    })
    expect(totalDocs).toBe(1)
  })

  it('republishing something expired clears its Expires, so it stays up', async () => {
    const id = await sentPost()
    await approve(id, { expiresAt: inHours(1).toISOString() })
    // Taken down an hour ago — the job's own write, with its mark, as the sweep makes it.
    await payload.update({
      collection: 'posts',
      id,
      data: { expiresAt: new Date(Date.now() - HOUR).toISOString(), _status: 'draft' } as never,
      draft: false,
      overrideAccess: true,
      context: { [SCHEDULED_RUN]: 'expire' },
    })
    expect((await live(id))._status).toBe('draft')

    await payload.update({
      collection: 'posts',
      id,
      data: { _status: 'published' } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const doc = await live(id)
    expect(doc._status).toBe('published')
    expect(doc.expiresAt ?? null).toBeNull()
  })
})
