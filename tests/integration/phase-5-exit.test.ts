import { createLocalReq, type Payload, type TypedUser } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { approveDocument, latestVersionToken } from '@/collections/endpoints/approve'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * The Phase 5 exit check (`05`): "every approval-path action is in the audit trail" — over the
 * real stack, for each Phase 5 content type. Pages are proven in `audit-trail.test.ts`; this adds
 * announcements (the approval loop and a delete), events (no approval — Jason, 2026-11-11 — but
 * the district sees a school's publish and delete in the activity log) and alerts (district
 * only, live at once: each save a publish, each removal a delete). Staff data is not on the
 * approval path: the sync writes it, and logs each run's summary (`docs/phases/05` §39).
 * The close-out maps every exit clause to its proof: `docs/phases/05` §41.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const trail = async (contentType: string, id: number | string) =>
  (
    await payload.find({
      collection: 'audit-events',
      where: {
        and: [{ contentType: { equals: contentType } }, { documentId: { equals: String(id) } }],
      },
      sort: 'createdAt',
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })
  ).docs

const asUser = (user: TypedUser) => createLocalReq({ user }, payload)

const words = (text: string) =>
  ({
    root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] },
  }) as never

describe('announcements: the approval loop and a delete', () => {
  it('send, send back, resend, approve, delete — each recorded, by the right people', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: {
        tenant: f.tenantA,
        board: f.boardA,
        title: 'Exit check: picture day',
        visibility: 'public',
        body: words('Thursday, in the gym.'),
        reviewState: 'submitted',
      } as never,
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    await payload.update({
      collection: 'posts',
      id: post.id,
      data: { reviewState: 'changes-requested', reviewNote: 'Add the time.' } as never,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await payload.update({
      collection: 'posts',
      id: post.id,
      data: { body: words('Thursday at 9, in the gym.'), reviewState: 'submitted' } as never,
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    const seen = await latestVersionToken(payload, 'posts', post.id)
    expect(await approveDocument(await asUser(f.districtAdmin), 'posts', post.id, seen)).toEqual({
      ok: true,
    })
    await payload.delete({
      collection: 'posts',
      id: post.id,
      user: f.districtAdmin,
      overrideAccess: false,
    })

    const entries = await trail('posts', post.id)
    expect(entries.map((e) => e.action)).toEqual([
      'submit',
      'request-changes',
      'submit',
      'approve',
      'delete',
    ])
    expect(entries.map((e) => e.actor)).toEqual([
      f.managerA.id,
      f.districtAdmin.id,
      f.managerA.id,
      f.districtAdmin.id,
      f.districtAdmin.id,
    ])
    expect(entries.every((e) => e.tenant === f.tenantA)).toBe(true)
    expect(entries[1]!.summary).toBe('Add the time.')
  })
})

describe('events: no approval, but nothing unseen (Jason, 2026-11-11)', () => {
  it('a school publishing and removing its own event is in the activity log', async () => {
    const event = await payload.create({
      collection: 'events',
      data: {
        tenant: f.tenantA,
        title: 'Exit check: open house',
        start: '2026-12-04T23:00:00.000Z',
        _status: 'published',
      } as never,
      user: f.managerA,
      overrideAccess: false,
    })
    await payload.delete({
      collection: 'events',
      id: event.id,
      user: f.managerA,
      overrideAccess: false,
    })

    const entries = await trail('events', event.id)
    expect(entries.map((e) => e.action)).toEqual(['publish', 'delete'])
    expect(entries.every((e) => e.actor === f.managerA.id)).toBe(true)
    expect(entries.every((e) => e.tenant === f.tenantA)).toBe(true)
  })
})

describe('alerts: district only, live at once', () => {
  it('posting one is a publish and removing it a delete, for no one school', async () => {
    const alert = await payload.create({
      collection: 'alerts',
      data: {
        kind: 'template',
        template: 'closure',
        date: 'Tuesday',
        reason: 'snow',
        siteScope: 'all',
        pageScope: 'every',
      } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await payload.delete({
      collection: 'alerts',
      id: alert.id,
      user: f.districtAdmin,
      overrideAccess: false,
    })

    const entries = await trail('alerts', alert.id)
    expect(entries.map((e) => e.action)).toEqual(['publish', 'delete'])
    expect(entries.every((e) => e.actor === f.districtAdmin.id)).toBe(true)
    expect(entries.every((e) => e.tenant === null || e.tenant === undefined)).toBe(true)
    expect(entries[0]!.documentTitle).toBe('Schools are closed on Tuesday because of snow.')
  })
})
