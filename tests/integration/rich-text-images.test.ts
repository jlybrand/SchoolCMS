import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { resolvePageBlocks } from '@/content/resolve-blocks'
import type { ContentContext, ResolvedPageBlock } from '@/content/types'

import { tinyPdf, tinyPng } from '../helpers/files'
import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * Images in TEXT (Jason, 2026-11-19: "insert images" in a more robust editor) — from the site's
 * library, where alt text is required (rule 7). The words store the file's id; the content layer
 * fills in its address and alt text, once per page. As the Image section: this site's library
 * only, refused on save otherwise.
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

const image = async (tenant: number, alt = 'Students in the gym') =>
  payload.create({
    collection: 'resources',
    data: { tenant, title: 'An image', alt } as never,
    file: await tinyPng(1200, 800),
    overrideAccess: true,
  })

/** A Text section whose words hold an image of `id` between two paragraphs. */
const textWithImage = (id: number | string) => ({
  blockType: 'richText',
  content: {
    root: {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', text: 'Before.' }] },
        { type: 'upload', relationTo: 'resources', value: id, fields: {}, version: 3 },
        { type: 'paragraph', children: [{ type: 'text', text: 'After.' }] },
      ],
    },
  },
})

let seq = 0
const page = (layout: unknown[], tenant: number = f.tenantA) => {
  seq += 1
  return payload.create({
    collection: 'pages',
    data: {
      tenant,
      title: `Words and pictures ${seq}`,
      slug: `words-pictures-${Date.now()}-${seq}`,
      visibility: 'public',
      layout,
    } as never,
    user: f.districtAdmin,
    overrideAccess: false,
  })
}

const wordsOf = (blocks: ResolvedPageBlock[]) => {
  const text = blocks.find((b) => b.kind === 'richText') as { content: unknown[] } | undefined
  return text?.content ?? []
}

describe('an image in the words', () => {
  it('is filled in from the library: its address and its alt text', async () => {
    const file = await image(f.tenantA, 'The new playground')
    await page([textWithImage(file.id)])
    const [block] = await resolvePageBlocks(
      ctx(),
      [
        {
          kind: 'richText',
          id: 'w',
          content: [{ kind: 'image', id: String(file.id), image: null }],
        } as never,
      ],
      { serverUrl: 'http://a.localhost' },
    )
    expect(wordsOf([block!])[0]).toMatchObject({
      kind: 'image',
      image: { alt: 'The new playground', src: expect.stringContaining('/api/resources/file/') },
    })
  })

  it('a file that is gone, or is not an image, stays empty — the page renders without it', async () => {
    const doc = await payload.create({
      collection: 'resources',
      data: { tenant: f.tenantA, title: 'A form', remediationStatus: 'attested' } as never,
      file: tinyPdf(),
      overrideAccess: true,
    })
    const [block] = await resolvePageBlocks(
      ctx(),
      [
        {
          kind: 'richText',
          id: 'w',
          content: [
            { kind: 'image', id: '999999', image: null },
            { kind: 'image', id: String(doc.id), image: null },
          ],
        } as never,
      ],
      { serverUrl: 'http://a.localhost' },
    )
    expect(wordsOf([block!])).toEqual([
      { kind: 'image', id: '999999', image: null },
      { kind: 'image', id: String(doc.id), image: null },
    ])
  })
})

describe('this site’s library only, as the Image section', () => {
  it('another school’s image in the words is refused on save; this site’s is kept', async () => {
    const theirs = await image(f.tenantB)
    await expect(page([textWithImage(theirs.id)])).rejects.toThrow()
    const mine = await image(f.tenantA)
    await expect(page([textWithImage(mine.id)])).resolves.toBeTruthy()
  })
})

describe('images only', () => {
  it('a document (a PDF) placed as an image in the words is refused on save, in words', async () => {
    const doc = await payload.create({
      collection: 'resources',
      data: { tenant: f.tenantA, title: 'A form', remediationStatus: 'attested' } as never,
      file: tinyPdf(),
      overrideAccess: true,
    })
    const refused = await page([textWithImage(doc.id)]).catch((error: unknown) => error)
    const errors = (refused as { data?: { errors?: { path: string; message: string }[] } }).data
      ?.errors
    expect(errors?.[0]).toMatchObject({
      path: 'layout.0.content',
      message: expect.stringMatching(/^Only images can go in the text/),
    })
  })
})
