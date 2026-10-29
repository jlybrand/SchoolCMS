import { createLocalReq, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  liveStillPublished,
  pageRevalidationTargets,
} from '@/collections/hooks/revalidate-on-publish'

import { getTestPayload, seed } from '../helpers/payload'

/**
 * A linked page's cached redirect names its target's path (Jason, 2026-10-29). When the target
 * is published — renamed, moved — every site with a page linked to it is revalidated with the
 * target's own, or that site keeps sending visitors to the old address until the hourly ISR.
 */

let payload: Payload
let f: Awaited<ReturnType<typeof seed>>
const made: (string | number)[] = []

const mk = async (data: Record<string, unknown>) => {
  const doc = await payload.create({
    collection: 'pages',
    data: { pageType: 'standard', visibility: 'public', _status: 'published', ...data } as never,
    user: f.districtAdmin,
    overrideAccess: true,
  })
  made.push(doc.id)
  return doc as unknown as Record<string, unknown> & { id: string | number }
}

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

afterAll(async () => {
  for (const id of made.reverse()) {
    await payload.delete({ collection: 'pages', id, overrideAccess: true }).catch(() => null)
  }
})

describe('pageRevalidationTargets', () => {
  it("is the page's own site when nothing links to it", async () => {
    const page = await mk({ tenant: f.districtTenant, title: 'Alone', slug: 'reval-alone' })
    const req = await createLocalReq({}, payload)
    expect(await pageRevalidationTargets(page, undefined, req)).toEqual([String(f.districtTenant)])
  })

  it('adds every site with a page linked to it', async () => {
    const target = await mk({ tenant: f.districtTenant, title: 'Target', slug: 'reval-target' })
    await mk({
      tenant: f.tenantA,
      title: 'To target',
      slug: 'reval-a',
      linkMode: 'redirect',
      linkTo: 'district',
      districtLinkTarget: target.id,
    })
    await mk({
      tenant: f.tenantB,
      title: 'To target too',
      slug: 'reval-b',
      linkMode: 'redirect',
      linkTo: 'district',
      districtLinkTarget: target.id,
    })
    const req = await createLocalReq({}, payload)
    expect((await pageRevalidationTargets(target, undefined, req)).sort()).toEqual(
      [String(f.districtTenant), String(f.tenantA), String(f.tenantB)].sort(),
    )
  })

  it('counts a same-site link once', async () => {
    const target = await mk({ tenant: f.tenantA, title: 'Local', slug: 'reval-local' })
    await mk({
      tenant: f.tenantA,
      title: 'To local',
      slug: 'reval-to-local',
      linkMode: 'redirect',
      linkTo: 'site',
      linkTarget: target.id,
    })
    const req = await createLocalReq({}, payload)
    expect(await pageRevalidationTargets(target, undefined, req)).toEqual([String(f.tenantA)])
  })
})

/** What tells an unpublish from a draft save (the page toolbar, Jason 2026-10-29). */
describe('liveStillPublished', () => {
  it('is true after a draft save over a published page, false after an unpublish', async () => {
    const page = await mk({ tenant: f.tenantA, title: 'Live check', slug: 'reval-live' })
    const req = await createLocalReq({}, payload)
    const stillLive = liveStillPublished('pages')

    await payload.update({
      collection: 'pages',
      id: page.id,
      data: { title: 'Live check, edited' },
      draft: true,
      user: f.districtAdmin,
      overrideAccess: true,
    })
    expect(await stillLive(page, req)).toBe(true)

    await payload.update({
      collection: 'pages',
      id: page.id,
      data: { _status: 'draft' },
      user: f.districtAdmin,
      overrideAccess: true,
    })
    expect(await stillLive(page, req)).toBe(false)
  })
})
