import { createLocalReq, type Payload, type TypedUser } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { approveDocument, latestVersionToken } from '@/collections/endpoints/approve'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * Approve publishes the version the reviewer SAW (`04` §4.1–4.2) — against real Payload, with
 * its real drafts, versions and autosave.
 *
 * The pure rule is `tests/unit/access/approval.test.ts`; this proves the operation around it:
 * that the token the queue reads is the one approve checks, that an autosave in between is
 * caught, and that what goes live is exactly what was read.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const live = (id: number) =>
  payload.findByID({ collection: 'pages', id, draft: false, depth: 0, overrideAccess: true })
const latest = (id: number) =>
  payload.findByID({ collection: 'pages', id, draft: true, depth: 0, overrideAccess: true })

const asUser = async (user: TypedUser) => createLocalReq({ user }, payload)

let seq = 0
/** A page in School A, sent for approval by School A's manager. */
const submittedPage = async (title = 'Bus routes') => {
  seq += 1
  const page = await payload.create({
    collection: 'pages',
    data: {
      tenant: f.tenantA,
      title: `${title} ${seq}`,
      slug: `approve-${Date.now()}-${seq}`,
      visibility: 'public',
      reviewState: 'submitted',
    },
    draft: true,
    user: f.managerA,
    overrideAccess: false,
  })
  return page.id
}

describe('approveDocument — pages', () => {
  it('publishes the version the district saw, and clears the review state', async () => {
    const id = await submittedPage()
    const seen = await latestVersionToken(payload, 'pages', id)
    expect(seen).not.toBeNull()

    const result = await approveDocument(await asUser(f.districtAdmin), 'pages', id, seen)
    expect(result).toEqual({ ok: true })

    const published = await live(id)
    expect(published._status).toBe('published')
    expect(published.title).toMatch(/^Bus routes \d+$/)
    expect(published.reviewState ?? null).toBeNull()
    expect(published.submittedBy ?? null).toBeNull()
  })

  it('refuses when the school autosaved after the district looked, and publishes nothing', async () => {
    const id = await submittedPage('Lunch menu')
    const seen = await latestVersionToken(payload, 'pages', id)

    // The school keeps typing. Autosave rewrites the latest version IN PLACE.
    await payload.update({
      collection: 'pages',
      id,
      data: { title: 'Lunch menu — CHANGED AFTER REVIEW' },
      draft: true,
      autosave: true,
      user: f.managerA,
      overrideAccess: false,
    })

    const result = await approveDocument(await asUser(f.districtAdmin), 'pages', id, seen)
    expect(result).toEqual({ ok: false, reason: 'changed' })
    expect((await live(id))._status).not.toBe('published')
    expect((await latest(id)).reviewState).toBe('submitted')
  })

  it('refuses a school manager, whatever token they hold', async () => {
    const id = await submittedPage()
    const seen = await latestVersionToken(payload, 'pages', id)
    expect(await approveDocument(await asUser(f.managerA), 'pages', id, seen)).toEqual({
      ok: false,
      reason: 'forbidden',
    })
    expect((await live(id))._status).not.toBe('published')
  })

  it('refuses a page that is not waiting', async () => {
    const id = await submittedPage()
    await payload.update({
      collection: 'pages',
      id,
      data: { reviewState: 'changes-requested', reviewNote: 'Add the times.' },
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const seen = await latestVersionToken(payload, 'pages', id)
    expect(await approveDocument(await asUser(f.districtAdmin), 'pages', id, seen)).toEqual({
      ok: false,
      reason: 'not-waiting',
    })
  })

  it('refuses a token from an earlier version once a newer one exists', async () => {
    const id = await submittedPage('Library hours')
    const stale = await latestVersionToken(payload, 'pages', id)
    await payload.update({
      collection: 'pages',
      id,
      data: { title: 'Library hours (new)' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    expect(await approveDocument(await asUser(f.districtAdmin), 'pages', id, stale)).toEqual({
      ok: false,
      reason: 'changed',
    })
  })

  it('an unknown page is not found', async () => {
    expect(
      await approveDocument(await asUser(f.districtAdmin), 'pages', 999_999, {
        versionId: '1',
        updatedAt: new Date().toISOString(),
      }),
    ).toEqual({ ok: false, reason: 'not-found' })
  })
})

/** Announcements go through the same one click, against their own versions. */
describe('approveDocument — posts', () => {
  const body = (text: string) =>
    ({
      root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] },
    }) as never

  const submittedPost = async (title = 'Picture day') => {
    seq += 1
    const post = await payload.create({
      collection: 'posts',
      data: {
        tenant: f.tenantA,
        board: f.boardA,
        title: `${title} ${seq}`,
        slug: `approve-post-${Date.now()}-${seq}`,
        visibility: 'public',
        body: body('Thursday.'),
        reviewState: 'submitted',
      },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    return post.id
  }

  const livePost = (id: number) =>
    payload.findByID({ collection: 'posts', id, draft: false, depth: 0, overrideAccess: true })

  it('publishes the announcement the district saw, and dates it', async () => {
    const id = await submittedPost()
    const seen = await latestVersionToken(payload, 'posts', id)
    expect(await approveDocument(await asUser(f.districtAdmin), 'posts', id, seen)).toEqual({
      ok: true,
    })
    const published = await livePost(id)
    expect(published._status).toBe('published')
    expect(published.reviewState ?? null).toBeNull()
    expect(published.publishedDate).toBeTruthy()
  })

  it('refuses when the school changed it after the district looked', async () => {
    const id = await submittedPost('Book fair')
    const seen = await latestVersionToken(payload, 'posts', id)
    await payload.update({
      collection: 'posts',
      id,
      data: { title: 'Book fair — CHANGED' },
      draft: true,
      autosave: true,
      user: f.managerA,
      overrideAccess: false,
    })
    const result = await approveDocument(await asUser(f.districtAdmin), 'posts', id, seen)
    expect(result).toEqual({ ok: false, reason: 'changed' })
    expect((await livePost(id))._status).toBe('draft')
  })

  it('a token read from a PAGE cannot approve a post', async () => {
    const pageId = await submittedPage('Same id elsewhere')
    const postId = await submittedPost('Target')
    const pageToken = await latestVersionToken(payload, 'pages', pageId)
    const result = await approveDocument(await asUser(f.districtAdmin), 'posts', postId, pageToken)
    expect(result).toEqual({ ok: false, reason: 'changed' })
  })

  it('refuses a school manager', async () => {
    const id = await submittedPost('Not theirs to approve')
    const seen = await latestVersionToken(payload, 'posts', id)
    expect(await approveDocument(await asUser(f.managerA), 'posts', id, seen)).toEqual({
      ok: false,
      reason: 'forbidden',
    })
  })
})
