import { createLocalReq, type Payload, type TypedUser } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadPublishHistory } from '@/admin/History/history-data'
import { approveDocument, latestVersionToken } from '@/collections/endpoints/approve'
import { runSchedule } from '@/collections/endpoints/schedule'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * A page's history as its publishes (Jason, 2026-11-12): each publish's activity-log entry names
 * the version it made, so the History list can open and restore exactly that version; and every
 * version is kept ("keep as much page/post history as possible"), so those links keep working.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const asUser = async (user: TypedUser) => createLocalReq({ user }, payload)
const HOUR = 60 * 60 * 1000

let seq = 0
const draftPage = async () => {
  seq += 1
  return (
    await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantA,
        title: `History ${seq}`,
        slug: `history-${Date.now()}-${seq}`,
        visibility: 'public',
      },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
  ).id
}

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
  ).docs[0] as { versionId?: string | null } | undefined

const publishedVersions = async (id: number | string) =>
  (
    await payload.findVersions({
      collection: 'pages',
      where: { and: [{ parent: { equals: id } }, { 'version._status': { equals: 'published' } }] },
      sort: '-updatedAt',
      pagination: false,
      overrideAccess: true,
    })
  ).docs

describe('each publish names the version it made', () => {
  it('a district publish', async () => {
    const id = await draftPage()
    await payload.update({
      collection: 'pages',
      id,
      data: { _status: 'published' },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const [newest] = await publishedVersions(id)
    expect((await entry(id, 'publish'))?.versionId).toBe(String(newest?.id))
  })

  it('an approval', async () => {
    const id = await draftPage()
    await payload.update({
      collection: 'pages',
      id,
      data: { reviewState: 'submitted' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    await approveDocument(
      await asUser(f.districtAdmin),
      'pages',
      id,
      await latestVersionToken(payload, 'pages', id),
    )
    const [newest] = await publishedVersions(id)
    expect((await entry(id, 'approve'))?.versionId).toBe(String(newest?.id))
  })

  it('a publish at its scheduled time', async () => {
    const id = await draftPage()
    await payload.update({
      collection: 'pages',
      id,
      data: {
        _status: 'draft',
        publishAt: new Date(Date.now() + HOUR).toISOString(),
        reviewState: 'scheduled',
      },
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await runSchedule(await createLocalReq({}, payload), new Date(Date.now() + 2 * HOUR))
    const [newest] = await publishedVersions(id)
    expect((await entry(id, 'publish'))?.versionId).toBe(String(newest?.id))
  })

  it('a draft save names none', async () => {
    const id = await draftPage()
    await payload.update({
      collection: 'pages',
      id,
      data: { reviewState: 'submitted' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    expect((await entry(id, 'submit'))?.versionId ?? null).toBeNull()
  })
})

describe('every version is kept', () => {
  it('the first published version is still there after more than 50 saves', async () => {
    const id = await draftPage()
    await payload.update({
      collection: 'pages',
      id,
      data: { _status: 'published' },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const [first] = await publishedVersions(id)
    for (let i = 0; i < 55; i += 1) {
      await payload.update({
        collection: 'pages',
        id,
        data: { title: `History edit ${i}` },
        draft: true,
        user: f.districtAdmin,
        overrideAccess: false,
      })
    }
    const kept = await payload.findVersionByID({
      collection: 'pages',
      id: String(first!.id),
      overrideAccess: true,
      disableErrors: true,
    })
    expect(kept).toBeTruthy()
  }, 60_000)
})

describe('loadPublishHistory', () => {
  it('lists the district its page’s publishes, each opening its version', async () => {
    const id = await draftPage()
    await payload.update({
      collection: 'pages',
      id,
      data: { _status: 'published', changeComment: 'First version.' } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const rows = await loadPublishHistory(await asUser(f.districtAdmin), 'pages', id)
    expect(rows).toHaveLength(1)
    const [newest] = await publishedVersions(id)
    expect(rows?.[0]).toMatchObject({
      label: 'Published',
      comment: 'First version.',
      href: `/admin/collections/pages/${id}/versions/${String(newest?.id)}`,
    })
  })

  it('is nothing for a school manager — page history is the district’s', async () => {
    const id = await draftPage()
    expect(await loadPublishHistory(await asUser(f.managerA), 'pages', id)).toBeNull()
  })
})
