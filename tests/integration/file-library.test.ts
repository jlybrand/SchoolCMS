import { createLocalReq, type Payload, type TypedUser } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  getLibraryFile,
  librarySites,
  listLibraryFiles,
  listLibraryFolders,
} from '@/admin/Resources/library-data'

import { tinyPdf, tinyPng } from '../helpers/files'
import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * The file library's reads over the real stack (Jason, 2026-11-17): read as the user AND scoped
 * to the one site on screen. A school can't list or open another school's files by changing the
 * address (`03` §6.4); the district sees nothing until it picks a site.
 */

let payload: Payload
let f: Fixtures
let folderA: number
let imageA: number
let docA: number
let imageB: number
const stamp = `${Date.now()}`

const asReq = (user: TypedUser) => createLocalReq({ user }, payload)
const all = { folder: 'all', q: '', kind: null, page: 1 } as const

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
  folderA = (
    await payload.create({
      collection: 'resource-folders',
      data: { tenant: f.tenantA, name: `Menus ${stamp}` } as never,
      overrideAccess: true,
    })
  ).id
  imageA = (
    await payload.create({
      collection: 'resources',
      data: { tenant: f.tenantA, title: `Gym photo ${stamp}`, alt: 'The gym' } as never,
      file: await tinyPng(40, 40),
      overrideAccess: true,
    })
  ).id
  docA = (
    await payload.create({
      collection: 'resources',
      data: {
        tenant: f.tenantA,
        folder: folderA,
        title: `Lunch menu ${stamp}`,
        description: 'November',
        tagsText: 'menus, lunch',
        remediationStatus: 'attested',
      } as never,
      file: tinyPdf(),
      overrideAccess: true,
    })
  ).id
  imageB = (
    await payload.create({
      collection: 'resources',
      data: { tenant: f.tenantB, title: `B photo ${stamp}`, alt: 'B' } as never,
      file: await tinyPng(40, 40),
      overrideAccess: true,
    })
  ).id
}, 120_000)

describe('sites', () => {
  it('the district chooses from every site, and starts with none', async () => {
    const { sites, site, district } = await librarySites(await asReq(f.districtAdmin), null)
    expect(district).toBe(true)
    expect(site).toBeNull()
    expect(sites.map((s) => s.id)).toEqual(
      expect.arrayContaining([String(f.tenantA), String(f.tenantB), String(f.districtTenant)]),
    )
  })

  it('a school manager is on their own school, and can’t ask for another', async () => {
    const own = await librarySites(await asReq(f.managerA), null)
    expect(own.site?.id).toBe(String(f.tenantA))
    expect(own.sites.map((s) => s.id)).toEqual([String(f.tenantA)])
    const other = await librarySites(await asReq(f.managerA), String(f.tenantB))
    expect(other.site?.id).toBe(String(f.tenantA))
  })
})

describe('isolation (`03` §6.4)', () => {
  it('School A’s manager listing School B’s site gets nothing', async () => {
    const req = await asReq(f.managerA)
    const { files } = await listLibraryFiles(req, String(f.tenantB), all, [])
    expect(files).toEqual([])
    expect(await listLibraryFolders(req, String(f.tenantB))).toEqual([])
  })

  it('a file from another site is not found, even for the district', async () => {
    expect(
      await getLibraryFile(await asReq(f.managerA), String(f.tenantB), String(imageB), []),
    ).toBeNull()
    expect(
      await getLibraryFile(await asReq(f.districtAdmin), String(f.tenantA), String(imageB), []),
    ).toBeNull()
  })
})

describe('listing', () => {
  it('by folder, search and kind', async () => {
    const req = await asReq(f.managerA)
    const site = String(f.tenantA)
    const folders = await listLibraryFolders(req, site)
    const inFolder = await listLibraryFiles(req, site, { ...all, folder: String(folderA) }, folders)
    expect(inFolder.files.map((x) => x.id)).toEqual([docA])
    expect(inFolder.files[0]?.folder).toBe(`Menus ${stamp}`)

    const searched = await listLibraryFiles(req, site, { ...all, q: `gym photo ${stamp}` }, folders)
    expect(searched.files.map((x) => x.id)).toEqual([imageA])

    const images = await listLibraryFiles(req, site, { ...all, kind: 'image', q: stamp }, folders)
    expect(images.files.map((x) => x.id)).toEqual([imageA])
  })

  it('the open file carries its details', async () => {
    const req = await asReq(f.managerA)
    const folders = await listLibraryFolders(req, String(f.tenantA))
    expect(await getLibraryFile(req, String(f.tenantA), String(docA), folders)).toMatchObject({
      id: docA,
      kind: 'document',
      description: 'November',
      tagsText: 'menus, lunch',
      folderId: String(folderA),
    })
  })
})
