import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { resolvePageBlocks } from '@/content/resolve-blocks'
import type { ContentContext, ResolvedDocumentListBlock } from '@/content/types'

import { tinyPdf, tinyPng } from '../helpers/files'
import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * The Document list block over the real stack (Jason, 2026-11-16): ONE folder of the site's own
 * library — checked on save, not only in the picker — listing its documents A–Z. A document
 * nobody has checked for accessibility is listed with a note (`07` §5). Schools may add one.
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

let seq = 0
const folder = async (tenant: number, name = 'Forms') => {
  seq += 1
  return (
    await payload.create({
      collection: 'resource-folders',
      data: { tenant, name: `${name} ${seq}` } as never,
      overrideAccess: true,
    })
  ).id
}

const document = async (
  tenant: number,
  folderId: number | null,
  title: string,
  remediationStatus = 'attested',
) =>
  payload.create({
    collection: 'resources',
    data: { tenant, folder: folderId, title, remediationStatus } as never,
    file: tinyPdf(),
    overrideAccess: true,
  })

const resolve = async (folderId: number) =>
  (await resolvePageBlocks(
    ctx(),
    [{ kind: 'documentList', id: 'd', heading: 'Forms', folder: String(folderId) }],
    { serverUrl: 'http://a.localhost' },
  )) as ResolvedDocumentListBlock[]

const page = (layout: unknown[], user: unknown = f.districtAdmin) => {
  seq += 1
  return payload.create({
    collection: 'pages',
    data: {
      tenant: f.tenantA,
      title: `Forms ${seq}`,
      slug: `forms-${Date.now()}-${seq}`,
      visibility: 'public',
      layout,
    } as never,
    draft: true,
    user: user as never,
    overrideAccess: false,
  })
}

describe('resolving', () => {
  it('the folder’s documents, A–Z, each with its type, and the site to ask for a copy', async () => {
    const forms = await folder(f.tenantA)
    await document(f.tenantA, forms, 'Medication form')
    await document(f.tenantA, forms, 'Bus request')
    await document(f.tenantA, forms, 'Allergy plan', 'not-attested')

    const [block] = await resolve(forms)
    expect(block).toMatchObject({ kind: 'documentList', heading: 'Forms', contactName: 'School A' })
    expect(block!.documents.map((d) => [d.title, d.fileType, d.unchecked])).toEqual([
      ['Allergy plan', 'PDF', true],
      ['Bus request', 'PDF', false],
      ['Medication form', 'PDF', false],
    ])
    expect(block!.documents[0]!.href).toMatch(/^\/api\/resources\/file\//)
  })

  it('only that folder — not its neighbours, not the images in it', async () => {
    const forms = await folder(f.tenantA)
    const other = await folder(f.tenantA, 'Menus')
    await document(f.tenantA, forms, 'In this folder')
    await document(f.tenantA, other, 'In another folder')
    await document(f.tenantA, null, 'In no folder')
    await payload.create({
      collection: 'resources',
      data: { tenant: f.tenantA, folder: forms, title: 'A photo', alt: 'Students' } as never,
      file: await tinyPng(400, 300),
      overrideAccess: true,
    })

    const [block] = await resolve(forms)
    expect(block!.documents.map((d) => d.title)).toEqual(['In this folder'])
  })

  it('an empty folder, or one that is gone, drops the block', async () => {
    expect(await resolve(await folder(f.tenantA))).toEqual([])
    expect(await resolve(999_999)).toEqual([])
  })

  it('never another site’s documents, even if a stored folder id points there', async () => {
    const theirs = await folder(f.tenantB)
    await document(f.tenantB, theirs, 'School B’s form')
    expect(await resolve(theirs)).toEqual([])
  })
})

describe('this site’s library only', () => {
  it('a page can’t list another school’s folder — refused on save', async () => {
    await expect(
      page([{ blockType: 'documentList', folder: await folder(f.tenantB) }]),
    ).rejects.toThrow()
    await expect(
      page([{ blockType: 'documentList', folder: await folder(f.tenantA) }]),
    ).resolves.toBeTruthy()
  })
})

describe('who may add one (`src/access/school-layout.ts`)', () => {
  it('a school manager may add a Document list of their own school’s folder', async () => {
    const mine = await folder(f.tenantA)
    await expect(
      page([{ blockType: 'documentList', heading: 'Forms', folder: mine }], f.managerA),
    ).resolves.toBeTruthy()
  })
})
