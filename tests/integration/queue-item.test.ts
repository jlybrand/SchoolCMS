import { createLocalReq, type Payload, type TypedUser } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadQueueItem } from '@/admin/Approvals/queue-data'
import { latestVersionToken } from '@/collections/endpoints/approve'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * One queue item, for the review panel on the page or announcement itself (Jason, 2026-11-12):
 * the same item the queue shows — diff, sender, wait and the version token approve checks — so
 * approving from the document is the queue's approve, not a second path.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const asUser = async (user: TypedUser) => createLocalReq({ user }, payload)

let seq = 0
const page = async (reviewState: 'submitted' | null) => {
  seq += 1
  return (
    await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantA,
        title: `Review panel ${seq}`,
        slug: `review-panel-${Date.now()}-${seq}`,
        visibility: 'public',
        ...(reviewState ? { reviewState } : {}),
      },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
  ).id
}

describe('loadQueueItem', () => {
  it('is the queue’s item for a waiting page, with the token approve checks', async () => {
    const id = await page('submitted')
    const item = await loadQueueItem(await asUser(f.districtAdmin), 'pages', id)
    expect(item).toMatchObject({
      id,
      collection: 'pages',
      noun: 'page',
      title: `Review panel ${seq}`,
      school: 'School A',
    })
    expect(item?.diff.isNew).toBe(true)
    expect(item?.token).toEqual(await latestVersionToken(payload, 'pages', id))
  })

  it('is nothing for a page that is not waiting', async () => {
    const id = await page(null)
    expect(await loadQueueItem(await asUser(f.districtAdmin), 'pages', id)).toBeNull()
  })

  it('is nothing for anyone but the district — a school manager reviews nothing', async () => {
    const id = await page('submitted')
    expect(await loadQueueItem(await asUser(f.managerA), 'pages', id)).toBeNull()
  })

  it('is nothing for a page that does not exist', async () => {
    expect(await loadQueueItem(await asUser(f.districtAdmin), 'pages', 99_999_999)).toBeNull()
  })
})
