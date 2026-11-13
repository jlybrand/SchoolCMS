import { createLocalReq, type Payload, type TypedUser } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { approveDocument, latestVersionToken } from '@/collections/endpoints/approve'
import { runSchedule } from '@/collections/endpoints/schedule'
import { SCHEDULED_RUN } from '@/collections/hooks/scheduled-dates'
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

    await runSchedule(await system(), inHours(1))
    expect((await live(id))._status).not.toBe('published')

    const run = await runSchedule(await system(), inHours(3))
    expect(run.published).toContain(`posts/${id}`)
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

    const run = await runSchedule(await system(), inHours(3))
    expect(run.published).not.toContain(`posts/${id}`)
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

  /**
   * The 404 Jason hit (2026-11-12). Payload hands the hook the NEWEST version as `originalDoc`,
   * and on a live post with an autosaved edit that version is a draft — so "is it live?" read from
   * it said no, the publish became a draft, and the live post came down until its Start.
   */
  it('a Start on a live post with a newer draft is refused too — the post stays up', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: {
        tenant: f.tenantA,
        board: f.boardA,
        title: `Live with a draft ${Date.now()}`,
        body: BODY,
        visibility: 'public',
        _status: 'published',
      } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await payload.update({
      collection: 'posts',
      id: post.id,
      data: { title: `Edited ${Date.now()}` } as never,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect((await latest(post.id))._status).toBe('draft')
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

    await runSchedule(await system(), inHours(4))
    expect((await live(id))._status).toBe('published')

    const run = await runSchedule(await system(), inHours(6))
    expect(run.expired).toContain(`posts/${id}`)
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

/**
 * A page's Start (Jason, 2026-11-04): the same schedule as an announcement's. Chosen when
 * publishing since 2026-11-11 — "Publish now" or "Schedule for…" — and cancelled there.
 */
describe('a page’s Start', () => {
  const page = (data: Record<string, unknown>) =>
    payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantA,
        title: `Scheduled page ${Date.now()}-${(seq += 1)}`,
        slug: `scheduled-page-${Date.now()}-${seq}`,
        visibility: 'public',
        ...data,
      } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
  const livePage = (id: number | string) =>
    payload.findByID({ collection: 'pages', id, draft: false, depth: 0, overrideAccess: true })

  it('publishing with a Start to come schedules the page; the sweep puts it live at its time', async () => {
    const created = await page({ publishAt: inHours(3).toISOString(), _status: 'published' })
    expect((await livePage(created.id))._status).toBe('draft')

    await runSchedule(await system(), inHours(2))
    expect((await livePage(created.id))._status).toBe('draft')

    const run = await runSchedule(await system(), inHours(4))
    expect(run.published).toContain(`pages/${created.id}`)
    expect((await livePage(created.id))._status).toBe('published')
  })

  it('a school can still edit a page the district scheduled — and never sees the Start', async () => {
    const created = await page({ publishAt: inHours(3).toISOString(), _status: 'published' })
    // The district places school A's manager on it by tenant; their save carries the stored Start.
    await expect(
      payload.update({
        collection: 'pages',
        id: created.id,
        data: { title: 'A school’s edit' } as never,
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      }),
    ).resolves.toBeTruthy()
    const seen = await payload.findByID({
      collection: 'pages',
      id: created.id,
      draft: true,
      depth: 0,
      user: f.managerA,
      overrideAccess: false,
    })
    expect(seen).not.toHaveProperty('publishAt')
    // Their edit was not approved: the schedule is dropped, so it does not go live by waiting.
    const run = await runSchedule(await system(), inHours(4))
    expect(run.published).not.toContain(`pages/${created.id}`)
  })

  it('a Start on a page already live is refused, with the way out', async () => {
    const created = await page({ _status: 'published' })
    await expect(
      payload.update({
        collection: 'pages',
        id: created.id,
        data: { publishAt: inHours(3).toISOString(), _status: 'published' } as never,
        user: f.districtAdmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/publishAt/)
  })

  it('a Start on a live page with a newer draft is refused too — the page stays up', async () => {
    const created = await page({ _status: 'published' })
    // An edit not yet published, as autosave leaves one: the newest version is now a draft.
    await payload.update({
      collection: 'pages',
      id: created.id,
      data: { title: `Edited ${Date.now()}` } as never,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await expect(
      payload.update({
        collection: 'pages',
        id: created.id,
        data: { publishAt: inHours(3).toISOString(), _status: 'published' } as never,
        user: f.districtAdmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow(/publishAt/)
    expect((await livePage(created.id))._status).toBe('published')
  })

  it('a page taken off the site can be scheduled again — it is not live', async () => {
    const created = await page({ _status: 'published' })
    await asDistrict(created.id, { _status: 'draft' })
    await asDistrict(created.id, { publishAt: inHours(3).toISOString(), _status: 'published' })
    expect((await livePage(created.id))._status).toBe('draft')
    expect((await draftPage(created.id)).reviewState).toBe('scheduled')
  })

  const draftPage = (id: number | string) =>
    payload.findByID({ collection: 'pages', id, draft: true, depth: 0, overrideAccess: true })
  const asDistrict = (id: number | string, data: Record<string, unknown>) =>
    payload.update({
      collection: 'pages',
      id,
      data: data as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })

  it('cancelling the schedule leaves a draft with nothing pending, and the sweep passes it by', async () => {
    const created = await page({ publishAt: inHours(3).toISOString(), _status: 'published' })
    await asDistrict(created.id, { _status: 'draft', publishAt: null, reviewState: null })

    const doc = await draftPage(created.id)
    expect(doc.reviewState ?? null).toBeNull()
    expect(doc.publishAt ?? null).toBeNull()
    const run = await runSchedule(await system(), inHours(4))
    expect(run.published).not.toContain(`pages/${created.id}`)
    expect((await livePage(created.id))._status).toBe('draft')
  })

  it('“Publish now” on a scheduled page puts it live at once and clears the Start', async () => {
    const created = await page({ publishAt: inHours(3).toISOString(), _status: 'published' })
    await asDistrict(created.id, { _status: 'published', publishAt: null })

    const doc = await livePage(created.id)
    expect(doc._status).toBe('published')
    expect(doc.publishAt ?? null).toBeNull()
    expect(doc.reviewState ?? null).toBeNull()
  })

  it('a new time reschedules it', async () => {
    const created = await page({ publishAt: inHours(3).toISOString(), _status: 'published' })
    const later = inHours(8).toISOString()
    await asDistrict(created.id, { _status: 'published', publishAt: later })

    const doc = await draftPage(created.id)
    expect(doc.reviewState).toBe('scheduled')
    expect(new Date(doc.publishAt as string).toISOString()).toBe(later)
    expect((await runSchedule(await system(), inHours(4))).published).not.toContain(
      `pages/${created.id}`,
    )
  })

  /**
   * Scheduling a CHANGE to a page already on the site (Jason, 2026-11-12): the edit is saved as a
   * draft marked `scheduled` — what the dialog's "At a set time" sends — so the page on the site
   * stays exactly as it is until the sweep publishes the change.
   */
  const scheduleChange = (id: number | string, data: Record<string, unknown>, at: Date) =>
    payload.update({
      collection: 'pages',
      id,
      data: {
        ...data,
        _status: 'draft',
        publishAt: at.toISOString(),
        reviewState: 'scheduled',
      } as never,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })

  it('a change to a live page can be scheduled: the page stays up as it was until its time', async () => {
    const created = await page({ title: 'Before', _status: 'published' })
    await scheduleChange(created.id, { title: 'After' }, inHours(3))

    const onSite = await livePage(created.id)
    expect(onSite._status).toBe('published')
    expect(onSite.title).toBe('Before')
    expect((await draftPage(created.id)).reviewState).toBe('scheduled')

    expect((await runSchedule(await system(), inHours(2))).published).not.toContain(
      `pages/${created.id}`,
    )
    expect((await livePage(created.id)).title).toBe('Before')

    const run = await runSchedule(await system(), inHours(4))
    expect(run.published).toContain(`pages/${created.id}`)
    const after = await livePage(created.id)
    expect(after).toMatchObject({ _status: 'published', title: 'After' })
    expect(after.reviewState ?? null).toBeNull()
  })

  it('the district’s later edits join the scheduled change', async () => {
    const created = await page({ title: 'Before', _status: 'published' })
    await scheduleChange(created.id, { title: 'After' }, inHours(3))
    // An autosave from the district's form: every field sent, the Start and state as stored.
    const stored = await draftPage(created.id)
    await payload.update({
      collection: 'pages',
      id: created.id,
      data: {
        title: 'After, edited',
        publishAt: stored.publishAt,
        reviewState: 'scheduled',
      } as never,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect((await draftPage(created.id)).reviewState).toBe('scheduled')
    expect((await livePage(created.id)).title).toBe('Before')

    await runSchedule(await system(), inHours(4))
    expect((await livePage(created.id)).title).toBe('After, edited')
  })

  it('cancelling a live page’s scheduled change keeps the page up and the edit as a draft', async () => {
    const created = await page({ title: 'Before', _status: 'published' })
    await scheduleChange(created.id, { title: 'After' }, inHours(3))
    await payload.update({
      collection: 'pages',
      id: created.id,
      data: { _status: 'draft', publishAt: null, reviewState: null } as never,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })

    expect(await livePage(created.id)).toMatchObject({ _status: 'published', title: 'Before' })
    const pending = await draftPage(created.id)
    expect(pending.title).toBe('After')
    expect(pending.reviewState ?? null).toBeNull()
    expect((await runSchedule(await system(), inHours(4))).published).not.toContain(
      `pages/${created.id}`,
    )
  })

  it('a school’s edit to a live page’s scheduled change drops the schedule', async () => {
    const created = await page({ title: 'Before', _status: 'published' })
    await scheduleChange(created.id, { title: 'After' }, inHours(3))
    await payload.update({
      collection: 'pages',
      id: created.id,
      data: { title: 'A school’s words' } as never,
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    expect((await runSchedule(await system(), inHours(4))).published).not.toContain(
      `pages/${created.id}`,
    )
    expect((await livePage(created.id)).title).toBe('Before')
  })

  it('a school manager cannot cancel a schedule', async () => {
    const created = await page({ publishAt: inHours(3).toISOString(), _status: 'published' })
    await expect(
      payload.update({
        collection: 'pages',
        id: created.id,
        data: { reviewState: null } as never,
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    expect((await draftPage(created.id)).reviewState).toBe('scheduled')
  })
})

/**
 * Alert banners (Jason, 2026-11-12): a start or end passing is not a write, so the sweep refreshes
 * every site when one passes since its last run — and only then.
 */
describe('alerts starting and ending', () => {
  const MIN = 60 * 1000
  const alertAt = (data: Record<string, unknown>) =>
    payload.create({
      collection: 'alerts',
      data: {
        kind: 'template',
        template: 'weather',
        expected: 'rain',
        siteScope: 'all',
        pageScope: 'every',
        ...data,
      } as never,
      overrideAccess: true,
    })

  it('refreshes the sites when an alert has just started or just ended', async () => {
    const now = new Date()
    const starting = await alertAt({ startAt: new Date(now.getTime() - 2 * MIN).toISOString() })
    const ending = await alertAt({
      startAt: new Date(now.getTime() - 60 * MIN).toISOString(),
      endAt: new Date(now.getTime() - 3 * MIN).toISOString(),
    })
    const run = await runSchedule(await system(), now)
    expect(run.refreshed).toContain(`alerts/${starting.id}`)
    expect(run.refreshed).toContain(`alerts/${ending.id}`)
  })

  it('leaves alone one that started long ago, or starts later', async () => {
    const now = new Date()
    const old = await alertAt({ startAt: new Date(now.getTime() - 60 * MIN).toISOString() })
    const later = await alertAt({ startAt: new Date(now.getTime() + 60 * MIN).toISOString() })
    const run = await runSchedule(await system(), now)
    expect(run.refreshed).not.toContain(`alerts/${old.id}`)
    expect(run.refreshed).not.toContain(`alerts/${later.id}`)
  })
})
