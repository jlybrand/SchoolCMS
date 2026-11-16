import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { getPostBySlug, listPosts } from '@/content/posts'
import type { ContentContext } from '@/content/types'

import { tinyPdf, tinyPng } from '../helpers/files'
import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * An announcement's image over the real stack (Jason, 2026-11-13): a file from its OWN site's
 * library, checked on save, not only in the picker. The post page and news lists receive it
 * ready, with the library's alt text; a file that is gone, or a document, is no image.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const ctx = (): ContentContext => ({
  tenant: {
    id: String(f.tenantA),
    slug: 'a',
    name: 'School A',
    hostname: 'a.localhost',
    type: 'school',
  },
  locale: 'en',
})

const image = async (tenant: number, data: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'resources',
    data: { tenant, title: 'An image', alt: 'Students in the gym', ...data } as never,
    file: await tinyPng(1200, 800),
    overrideAccess: true,
  })

const words = {
  root: {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Thursday.' }] }],
  },
}

let seq = 0
/** A published, public post on School A, as the district writes it. */
const post = async (heroImage: unknown, user: unknown = f.districtAdmin) => {
  seq += 1
  const slug = `picture-day-${Date.now()}-${seq}`
  await payload.create({
    collection: 'posts',
    data: {
      tenant: f.tenantA,
      board: f.boardA,
      title: `Picture day ${seq}`,
      slug,
      body: words,
      visibility: 'public',
      heroImage,
      _status: 'published',
    } as never,
    user: user as never,
    overrideAccess: user === f.districtAdmin,
  })
  return slug
}

describe('the post page and news lists receive it ready', () => {
  it('the library’s sizes and alt text, on the page and in the list', async () => {
    const file = await image(f.tenantA)
    const slug = await post(file.id)

    const shown = await getPostBySlug(ctx(), slug)
    expect(shown?.image).toMatchObject({ alt: 'Students in the gym', width: 800 })
    expect(shown?.image?.srcSet).toMatch(/400w, .* 800w, .* 1200w$/)

    const listed = (await listPosts(ctx(), { limit: 100 })).find((p) => p.slug === slug)
    expect(listed?.image).toMatchObject({ alt: 'Students in the gym' })
  })

  it('no image chosen, or the file is gone: no image, and the post still shows', async () => {
    const none = await getPostBySlug(ctx(), await post(null))
    expect(none?.image).toBeNull()

    const file = await image(f.tenantA)
    const slug = await post(file.id)
    await payload.delete({ collection: 'resources', id: file.id, overrideAccess: true })
    const gone = await getPostBySlug(ctx(), slug)
    expect(gone).not.toBeNull()
    expect(gone?.image).toBeNull()
  })
})

describe('its own site’s images only', () => {
  it('another school’s image, or a document, is refused on save', async () => {
    const theirs = await image(f.tenantB)
    await expect(post(theirs.id)).rejects.toThrow()

    const doc = await payload.create({
      collection: 'resources',
      data: { tenant: f.tenantA, title: 'A form', remediationStatus: 'not-applicable' } as never,
      file: tinyPdf(),
      overrideAccess: true,
    })
    await expect(post(doc.id)).rejects.toThrow()
  })

  it('a school manager may choose one of their own school’s images', async () => {
    const mine = await image(f.tenantA)
    const created = await payload.create({
      collection: 'posts',
      data: {
        tenant: f.tenantA,
        board: f.boardA,
        title: 'Our picture day',
        slug: `our-picture-day-${Date.now()}`,
        heroImage: mine.id,
      } as never,
      draft: true,
      user: f.managerA as never,
      overrideAccess: false,
    })
    expect((created as { heroImage?: unknown }).heroImage).toBeTruthy()
  })
})
