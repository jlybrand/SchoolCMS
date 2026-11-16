import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { resolvePageBlocks } from '@/content/resolve-blocks'
import type { ContentContext } from '@/content/types'

import { tinyPdf, tinyPng } from '../helpers/files'
import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * The Image and Hero blocks over the real stack (Jason, 2026-11-13): each shows a file from THIS
 * site's library — checked on save, not only in the picker — with the library's alt text (empty
 * for decorative). A block whose file is gone, or isn't an image, goes too. Schools may add an
 * Image; the Hero is the district's.
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

const resolve = (blocks: Parameters<typeof resolvePageBlocks>[1]) =>
  resolvePageBlocks(ctx(), blocks, { serverUrl: 'http://a.localhost' })

let seq = 0
const page = (layout: unknown[], user: unknown = f.districtAdmin, tenant: number = f.tenantA) => {
  seq += 1
  return payload.create({
    collection: 'pages',
    data: {
      tenant,
      title: `Pictures ${seq}`,
      slug: `pictures-${Date.now()}-${seq}`,
      visibility: 'public',
      layout,
    } as never,
    draft: true,
    user: user as never,
    overrideAccess: false,
  })
}

describe('resolving', () => {
  it('an image block: the library’s sizes and alt text', async () => {
    const file = await image(f.tenantA)
    const [block] = await resolve([
      { kind: 'image', id: 'i', image: String(file.id), caption: 'The gym' },
    ])
    expect(block).toMatchObject({
      kind: 'image',
      caption: 'The gym',
      image: { alt: 'Students in the gym', width: 800 },
    })
    const srcSet = (block as { image: { srcSet: string } }).image.srcSet
    expect(srcSet).toMatch(/400w, .* 800w, .* 1200w$/)
  })

  it('a decorative image has empty alt text; a hero resolves the same way', async () => {
    const file = await image(f.tenantA, { alt: undefined, isDecorative: true })
    const [hero] = await resolve([
      {
        kind: 'hero',
        id: 'h',
        image: String(file.id),
        heading: null,
        subheading: null,
        href: null,
        linkLabel: null,
        newTab: false,
      },
    ])
    expect(hero).toMatchObject({ kind: 'hero', image: { alt: '' } })
  })

  it('a missing file, or a document, drops the block', async () => {
    const doc = await payload.create({
      collection: 'resources',
      data: { tenant: f.tenantA, title: 'A form', remediationStatus: 'not-applicable' } as never,
      file: tinyPdf(),
      overrideAccess: true,
    })
    expect(
      await resolve([
        { kind: 'image', id: 'gone', image: '999999', caption: null },
        { kind: 'image', id: 'doc', image: String(doc.id), caption: null },
      ]),
    ).toEqual([])
  })
})

describe('this site’s library only', () => {
  it('a page can’t show another school’s image — refused on save', async () => {
    const theirs = await image(f.tenantB)
    await expect(page([{ blockType: 'image', image: theirs.id }])).rejects.toThrow()
    const mine = await image(f.tenantA)
    await expect(page([{ blockType: 'image', image: mine.id }])).resolves.toBeTruthy()
  })
})

describe('who may add them (`src/access/school-layout.ts`)', () => {
  it('a school manager may add an Image; never a Hero', async () => {
    const mine = await image(f.tenantA)
    await expect(page([{ blockType: 'image', image: mine.id }], f.managerA)).resolves.toBeTruthy()
    await expect(page([{ blockType: 'hero', image: mine.id }], f.managerA)).rejects.toThrow()
  })
})
