import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { getTestPayload, isDenied, seed, type Fixtures } from '../helpers/payload'

/**
 * The review workflow against the real stack (`04` §4.1).
 *
 * `tests/unit/access/review-state.test.ts` owns the transition table. This proves the table
 * is what Payload actually does: the hook runs on every route, the fields persist through
 * drafts and versions, and the live page is untouched until the district approves.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const latest = (id: number) =>
  payload.findByID({ collection: 'pages', id, draft: true, depth: 0, overrideAccess: true })

const live = (id: number) =>
  payload.findByID({ collection: 'pages', id, draft: false, depth: 0, overrideAccess: true })

describe('the loop — send, send back, resend, approve', () => {
  let pageId: number

  it('a school manager creates a page and sends it in one write', async () => {
    const page = await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantA,
        title: 'Bus routes',
        slug: 'bus-routes',
        visibility: 'public',
        reviewState: 'submitted',
      },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    pageId = page.id

    const stored = await latest(pageId)
    expect(stored._status).toBe('draft')
    expect(stored.reviewState).toBe('submitted')
    expect(stored.submittedBy).toBe(f.managerA.id)
    expect(stored.submittedAt).toEqual(expect.any(String))
  })

  it('the school cannot send it back to itself', async () => {
    const denied = await isDenied(() =>
      payload.update({
        collection: 'pages',
        id: pageId,
        data: { reviewState: 'changes-requested', reviewNote: 'Looks fine' },
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
    expect((await latest(pageId)).reviewState).toBe('submitted')
  })

  it('the district cannot send it back without saying why', async () => {
    const denied = await isDenied(() =>
      payload.update({
        collection: 'pages',
        id: pageId,
        data: { reviewState: 'changes-requested', reviewNote: '  ' },
        draft: true,
        user: f.districtAdmin,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
    expect((await latest(pageId)).reviewState).toBe('submitted')
  })

  it('the district sends it back with a note', async () => {
    await payload.update({
      collection: 'pages',
      id: pageId,
      data: { reviewState: 'changes-requested', reviewNote: 'Route 4 moved in August.' },
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })

    const stored = await latest(pageId)
    expect(stored.reviewState).toBe('changes-requested')
    expect(stored.reviewNote).toBe('Route 4 moved in August.')
    expect(stored.submittedBy).toBe(f.managerA.id)
  })

  it('the school edits it, and the note stays until they resend', async () => {
    await payload.update({
      collection: 'pages',
      id: pageId,
      data: { title: 'Bus routes 2026–27' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    const stored = await latest(pageId)
    expect(stored.title).toBe('Bus routes 2026–27')
    expect(stored.reviewState).toBe('changes-requested')
    expect(stored.reviewNote).toBe('Route 4 moved in August.')
  })

  it('resending queues it again and clears the note', async () => {
    await payload.update({
      collection: 'pages',
      id: pageId,
      data: { reviewState: 'submitted' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    const stored = await latest(pageId)
    expect(stored.reviewState).toBe('submitted')
    expect(stored.reviewNote ?? null).toBeNull()
  })

  it('the district approves: the page goes live and the review clears', async () => {
    await payload.update({
      collection: 'pages',
      id: pageId,
      data: { _status: 'published' },
      user: f.districtAdmin,
      overrideAccess: false,
    })

    const published = await live(pageId)
    expect(published._status).toBe('published')
    expect(published.title).toBe('Bus routes 2026–27')
    expect(published.reviewState ?? null).toBeNull()
    expect(published.submittedBy ?? null).toBeNull()
    expect(published.submittedAt ?? null).toBeNull()
  })
})

describe('a change to a page that is already live', () => {
  /**
   * THE CASE DRAFTS EXIST FOR. The school's edit is a new draft version; the published
   * version keeps serving until the district approves. If the review fields or the edit
   * leaked onto the live version, the public site would show unapproved content.
   */
  it('stays a draft beside the live page until approved', async () => {
    const before = await live(f.publishedPageA)

    await payload.update({
      collection: 'pages',
      id: f.publishedPageA,
      data: { title: 'Proposed new title', reviewState: 'submitted' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })

    const draft = await latest(f.publishedPageA)
    expect(draft.title).toBe('Proposed new title')
    expect(draft.reviewState).toBe('submitted')

    const stillLive = await live(f.publishedPageA)
    expect(stillLive.title).toBe(before.title)
    expect(stillLive._status).toBe('published')

    await payload.update({
      collection: 'pages',
      id: f.publishedPageA,
      data: { _status: 'published' },
      user: f.districtAdmin,
      overrideAccess: false,
    })

    const approved = await live(f.publishedPageA)
    expect(approved.title).toBe('Proposed new title')
    expect(approved.reviewState ?? null).toBeNull()
  })

  /**
   * A further save on a queued change keeps it queued, with its original age. Payload merges
   * the stored state into the write, so this cannot be told apart from a resend.
   */
  it('a further edit to a queued change keeps it queued, and keeps its age', async () => {
    await payload.update({
      collection: 'pages',
      id: f.publishedPageA,
      data: { title: 'Queued', reviewState: 'submitted' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    const queuedAt = (await latest(f.publishedPageA)).submittedAt

    await payload.update({
      collection: 'pages',
      id: f.publishedPageA,
      data: { title: 'Queued, then changed' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    const stored = await latest(f.publishedPageA)
    expect(stored.title).toBe('Queued, then changed')
    expect(stored.reviewState).toBe('submitted')
    expect(stored.submittedAt).toBe(queuedAt)
  })
})

describe('autosave (`04` §2.3)', () => {
  /**
   * Autosave is a draft write like any other — it goes through the publish gate and the
   * review hook. It must never publish, and never move the review state.
   */
  it('an autosave on a queued page keeps it queued and the live page untouched', async () => {
    const liveBefore = await live(f.publishedPageA)
    const queued = await latest(f.publishedPageA)
    expect(queued.reviewState).toBe('submitted')

    await payload.update({
      collection: 'pages',
      id: f.publishedPageA,
      data: { title: 'Typed, not sent' },
      draft: true,
      autosave: true,
      user: f.managerA,
      overrideAccess: false,
    })

    const after = await latest(f.publishedPageA)
    expect(after.title).toBe('Typed, not sent')
    expect(after.reviewState).toBe('submitted')
    expect(after.submittedAt).toBe(queued.submittedAt)
    expect((await live(f.publishedPageA)).title).toBe(liveBefore.title)
  })

  it('an autosave on a page with nothing pending marks it as being edited', async () => {
    await payload.update({
      collection: 'pages',
      id: f.staffPageA,
      data: { title: 'Staff, typed' },
      draft: true,
      autosave: true,
      user: f.managerA,
      overrideAccess: false,
    })
    expect((await latest(f.staffPageA)).reviewState).toBe('editing')
  })
})

describe('what a school manager cannot forge', () => {
  it('a reviewer note or a submitter sent with a submission is overwritten', async () => {
    await payload.update({
      collection: 'pages',
      id: f.draftPageA,
      data: {
        reviewState: 'submitted',
        reviewNote: 'Approved by the district',
        submittedBy: f.districtAdmin.id,
      },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    const stored = await latest(f.draftPageA)
    expect(stored.reviewNote ?? null).toBeNull()
    expect(stored.submittedBy).toBe(f.managerA.id)
  })

  it('a BULK update cannot send pages back', async () => {
    await isDenied(() =>
      payload.update({
        collection: 'pages',
        where: { tenant: { equals: f.tenantA } },
        data: { reviewState: 'changes-requested', reviewNote: 'bulk' },
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect((await latest(f.draftPageA)).reviewState).toBe('submitted')
  })

  it("cannot move another school's page through review", async () => {
    const denied = await isDenied(() =>
      payload.update({
        collection: 'pages',
        id: f.publishedPageB,
        data: { reviewState: 'submitted' },
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
    expect((await latest(f.publishedPageB)).reviewState ?? null).toBeNull()
  })
})
