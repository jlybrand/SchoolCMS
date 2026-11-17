import { createLocalReq, type Payload, type TypedUser } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { getFileUses } from '@/admin/Resources/file-uses-data'

import { tinyPdf, tinyPng } from '../helpers/files'
import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * "Where it's used" over the real stack (Jason, 2026-11-17): a file's PUBLISHED uses only, found
 * from its own site's pages and announcements, and from other sites' pages reusing a district
 * page. Isolation: a school asking about another school's file gets nothing (`03` §6.4). The rule
 * itself is `tests/unit/lib/file-uses.test.ts`.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

let seq = 0
const next = () => {
  seq += 1
  return `${Date.now()}-${seq}`
}

const image = async (tenant: number) =>
  payload.create({
    collection: 'resources',
    data: { tenant, title: `Photo ${next()}`, alt: 'Students in the gym' } as never,
    file: await tinyPng(1200, 800),
    overrideAccess: true,
  })

const page = async (tenant: number, layout: unknown[], extra: Record<string, unknown> = {}) => {
  const stamp = next()
  return payload.create({
    collection: 'pages',
    data: {
      tenant,
      title: `Page ${stamp}`,
      slug: `uses-${stamp}`,
      visibility: 'public',
      layout,
      _status: 'published',
      ...extra,
    } as never,
    // The publish gate wants a publisher even with access overridden.
    user: f.districtAdmin,
    overrideAccess: true,
  })
}

const usesFor = async (user: TypedUser, id: number | string) =>
  getFileUses(await createLocalReq({ user }, payload), id)

const words = {
  root: {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Thursday.' }] }],
  },
}

describe('published only (Jason)', () => {
  it('a published page is listed; a draft-only page is not', async () => {
    const file = await image(f.tenantA)
    const live = await page(f.tenantA, [{ blockType: 'image', image: file.id }])
    await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantA,
        title: 'Never published',
        slug: `draft-${next()}`,
        visibility: 'public',
        layout: [{ blockType: 'image', image: file.id }],
      } as never,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: true,
    })
    const uses = await usesFor(f.managerA, file.id)
    expect(uses?.pages.map((p) => p.id)).toEqual([live.id])
  })

  it('a newer draft that drops the file leaves the published use listed', async () => {
    const file = await image(f.tenantA)
    const live = await page(f.tenantA, [{ blockType: 'image', image: file.id }])
    await payload.update({
      collection: 'pages',
      id: live.id,
      data: { layout: [{ blockType: 'divider' }] } as never,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: true,
    })
    expect((await usesFor(f.managerA, file.id))?.pages.map((p) => p.id)).toEqual([live.id])
  })

  it('a newer draft that ADDS the file isn’t listed until it’s published', async () => {
    const file = await image(f.tenantA)
    const live = await page(f.tenantA, [{ blockType: 'divider' }])
    await payload.update({
      collection: 'pages',
      id: live.id,
      data: { layout: [{ blockType: 'image', image: file.id }] } as never,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: true,
    })
    expect((await usesFor(f.managerA, file.id))?.pages).toEqual([])
  })
})

describe('where', () => {
  it('inside Columns, with the page’s address', async () => {
    const file = await image(f.tenantA)
    const made = await page(f.tenantA, [
      {
        blockType: 'columns',
        columns: [
          { content: [{ blockType: 'divider' }] },
          { content: [{ blockType: 'image', image: file.id }] },
        ],
      },
    ])
    const uses = await usesFor(f.districtAdmin, file.id)
    expect(uses?.pages).toEqual([
      { id: made.id, title: made.title, path: `/${made.slug}`, via: ['image'], staffOnly: false },
    ])
  })

  it('a document, through the Document list of its folder', async () => {
    const folder = await payload.create({
      collection: 'resource-folders',
      data: { tenant: f.tenantA, name: `Forms ${next()}` } as never,
      overrideAccess: true,
    })
    const doc = await payload.create({
      collection: 'resources',
      data: {
        tenant: f.tenantA,
        folder: folder.id,
        title: 'Enrollment form',
        remediationStatus: 'attested',
      } as never,
      file: tinyPdf(),
      overrideAccess: true,
    })
    const made = await page(f.tenantA, [{ blockType: 'documentList', folder: folder.id }])
    const uses = await usesFor(f.managerA, doc.id)
    expect(uses?.pages).toEqual([expect.objectContaining({ id: made.id, via: ['document list'] })])
  })

  it('an announcement’s image, with the sites it’s shared to', async () => {
    const file = await image(f.tenantA)
    const post = await payload.create({
      collection: 'posts',
      data: {
        tenant: f.tenantA,
        board: f.boardA,
        title: `Picture day ${next()}`,
        slug: `picture-day-${next()}`,
        body: words,
        visibility: 'public',
        heroImage: file.id,
        syndication: { scope: 'selected', syndicatedTo: [f.tenantB] },
        _status: 'published',
      } as never,
      user: f.districtAdmin,
      overrideAccess: true,
    })
    const tenantB = await payload.findByID({ collection: 'tenants', id: f.tenantB, depth: 0 })
    const uses = await usesFor(f.managerA, file.id)
    expect(uses?.announcements).toEqual([
      { id: post.id, title: post.title, alsoOn: [tenantB.name] },
    ])
  })

  it('a school page showing a district page that uses the file', async () => {
    const file = await image(f.districtTenant)
    const source = await page(f.districtTenant, [{ blockType: 'hero', image: file.id }])
    const reuser = await page(f.tenantA, [], {
      linkMode: 'reuse',
      districtLinkTarget: source.id,
    })
    const tenantA = await payload.findByID({ collection: 'tenants', id: f.tenantA, depth: 0 })
    const uses = await usesFor(f.districtAdmin, file.id)
    expect(uses?.linked).toEqual([{ id: reuser.id, title: reuser.title, site: tenantA.name }])
  })
})

describe('isolation (`03` §6.4)', () => {
  it('School B’s manager gets nothing for School A’s file; School A’s manager sees it', async () => {
    const file = await image(f.tenantA)
    await page(f.tenantA, [{ blockType: 'image', image: file.id }])
    expect(await usesFor(f.managerB, file.id)).toBeNull()
    expect((await usesFor(f.managerA, file.id))?.pages).toHaveLength(1)
  })

  it('a malformed id reads as nothing', async () => {
    expect(await usesFor(f.managerA, '1 OR 1=1')).toBeNull()
  })
})
