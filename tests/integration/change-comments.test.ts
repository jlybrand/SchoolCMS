import { createLocalReq, type Payload, type TypedUser } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadQueueItem } from '@/admin/Approvals/queue-data'
import { approveDocument, latestVersionToken } from '@/collections/endpoints/approve'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * The optional comment on Publish, Schedule and Send for approval (Jason, 2026-11-12), over the
 * real stack: it rides on a write as `changeComment` — a VIRTUAL field, never stored on the page
 * — and lands on that write's activity-log entry, where the queue, the emails and the page's
 * history read it.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const asUser = async (user: TypedUser) => createLocalReq({ user }, payload)

let seq = 0
const draftPage = async () => {
  seq += 1
  return (
    await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantA,
        title: `Commented ${seq}`,
        slug: `commented-${Date.now()}-${seq}`,
        visibility: 'public',
      },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
  ).id
}

/** The newest activity-log entry for a page and an action. */
const entry = async (id: number | string, action: string) =>
  (
    await payload.find({
      collection: 'audit-events',
      where: {
        and: [
          { contentType: { equals: 'pages' } },
          { documentId: { equals: String(id) } },
          { action: { equals: action } },
        ],
      },
      sort: '-createdAt',
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0] as { comment?: string } | undefined

const send = (id: number | string, comment?: string) =>
  payload.update({
    collection: 'pages',
    id,
    data: { reviewState: 'submitted', ...(comment ? { changeComment: comment } : {}) } as never,
    draft: true,
    user: f.managerA,
    overrideAccess: false,
  })

describe('changeComment — on the write’s activity-log entry, never on the page', () => {
  it('a school’s comment on sending is on the submit entry', async () => {
    const id = await draftPage()
    await send(id, '  Spring bus times.  ')
    expect((await entry(id, 'submit'))?.comment).toBe('Spring bus times.')
  })

  it('is not stored on the page: reading it back has none, and the next write carries none', async () => {
    const id = await draftPage()
    await send(id, 'Once only.')
    const read = (await payload.findByID({
      collection: 'pages',
      id,
      draft: true,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>
    expect(read.changeComment ?? null).toBeNull()
    await payload.update({
      collection: 'pages',
      id,
      data: { _status: 'published' },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect((await entry(id, 'approve'))?.comment ?? '').toBe('')
  })

  it('the district’s comment on publishing is on the publish entry', async () => {
    const id = await draftPage()
    await payload.update({
      collection: 'pages',
      id,
      data: { _status: 'published', changeComment: 'Checked with the principal.' } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect((await entry(id, 'publish'))?.comment).toBe('Checked with the principal.')
  })

  it('a comment on approving is on the approve entry', async () => {
    const id = await draftPage()
    await send(id)
    const seen = await latestVersionToken(payload, 'pages', id)
    const result = await approveDocument(
      await asUser(f.districtAdmin),
      'pages',
      id,
      seen,
      undefined,
      'Looks good.',
    )
    expect(result).toEqual({ ok: true })
    expect((await entry(id, 'approve'))?.comment).toBe('Looks good.')
  })

  it('the queue shows the school’s comment with what it sent', async () => {
    const id = await draftPage()
    await send(id, 'New lunch menu.')
    const item = await loadQueueItem(await asUser(f.districtAdmin), 'pages', id)
    expect(item?.comment).toBe('New lunch menu.')
  })

  it('a send with no comment shows none in the queue', async () => {
    const id = await draftPage()
    await send(id)
    expect((await loadQueueItem(await asUser(f.districtAdmin), 'pages', id))?.comment).toBe('')
  })
})
