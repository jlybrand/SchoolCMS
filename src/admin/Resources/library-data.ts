import type { PayloadRequest, Where } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { schoolsOf, toMyFile, type MyFile } from '@/admin/SchoolPlane/school-data'

import { PAGE_SIZE, type FolderRow, type LibraryParams } from './file-library'

/**
 * The file library's reads (Jason, 2026-11-17). Files and folders are read AS THE USER
 * (`overrideAccess: false`), so access decides: a school manager reads only their own schools'
 * (`src/access/resources.ts`), the district every site's. Every read is ALSO scoped to the one
 * site on screen, so a school's `?site=` for another school lists nothing, and a `?file=` from
 * another site is not found.
 */

export type LibrarySite = { id: string; name: string }

/**
 * The sites this user may choose and the one on screen. The district chooses from every site
 * and starts with none; a school manager is on their own school (or picks, with two).
 */
export const librarySites = async (
  req: PayloadRequest,
  asked: string | null,
): Promise<{ sites: LibrarySite[]; site: LibrarySite | null; district: boolean }> => {
  const user = req.user as AuthUser | null
  const district = isDistrictAdmin(user)
  const sites = district
    ? (
        await req.payload.find({
          collection: 'tenants',
          req,
          overrideAccess: true,
          depth: 0,
          pagination: false,
          sort: 'name',
          select: { name: true },
        })
      ).docs.map((t) => ({
        id: String(t.id),
        name: typeof t.name === 'string' ? t.name : String(t.id),
      }))
    : (await schoolsOf(req.payload, user)).map((s) => ({ id: String(s.id), name: s.name }))
  const site =
    sites.find((s) => s.id === asked) ?? (!district && sites.length === 1 ? sites[0]! : null)
  return { sites, site, district }
}

export type LibraryFolder = FolderRow & { label: string }

/** The site's folders, read as the user. */
export const listLibraryFolders = async (
  req: PayloadRequest,
  site: string,
): Promise<LibraryFolder[]> => {
  const { docs } = await req.payload.find({
    collection: 'resource-folders',
    req,
    user: req.user,
    overrideAccess: false,
    depth: 0,
    pagination: false,
    sort: 'label',
    where: { tenant: { equals: site } },
    select: { name: true, parent: true, label: true },
  })
  return docs.map((d) => ({
    id: d.id,
    name: d.name,
    parent: d.parent ?? null,
    label: typeof d.label === 'string' && d.label !== '' ? d.label : String(d.name ?? d.id),
  }))
}

const labelsOf = (folders: readonly LibraryFolder[]) =>
  new Map(folders.map((f) => [String(f.id), f.label]))

/** One page of the site's files, by title, narrowed by folder, search and kind. */
export const listLibraryFiles = async (
  req: PayloadRequest,
  site: string,
  params: Pick<LibraryParams, 'folder' | 'q' | 'kind' | 'page'>,
  folders: readonly LibraryFolder[],
): Promise<{ files: MyFile[]; totalPages: number; totalDocs: number }> => {
  const and: Where[] = [{ tenant: { equals: site } }]
  if (params.folder !== 'all') and.push({ folder: { equals: params.folder } })
  if (params.q !== '') and.push({ title: { like: params.q } })
  if (params.kind !== null) and.push({ kind: { equals: params.kind } })
  const result = await req.payload.find({
    collection: 'resources',
    req,
    user: req.user,
    overrideAccess: false,
    depth: 0,
    limit: PAGE_SIZE,
    page: params.page,
    sort: 'title',
    where: { and },
  })
  const labels = labelsOf(folders)
  return {
    files: result.docs
      .map((doc) => toMyFile(doc as unknown as Record<string, unknown>, labels))
      .filter((f): f is MyFile => f !== null),
    totalPages: result.totalPages,
    totalDocs: result.totalDocs,
  }
}

export type LibraryFile = MyFile & {
  description: string
  tagsText: string
  folderId: string | null
  filename: string
}

/** The open file, if it's on this site and the user may read it; otherwise null. */
export const getLibraryFile = async (
  req: PayloadRequest,
  site: string,
  id: string,
  folders: readonly LibraryFolder[],
): Promise<LibraryFile | null> => {
  const { docs } = await req.payload.find({
    collection: 'resources',
    req,
    user: req.user,
    overrideAccess: false,
    depth: 0,
    limit: 1,
    where: { and: [{ id: { equals: id } }, { tenant: { equals: site } }] },
  })
  const doc = docs[0] as unknown as Record<string, unknown> | undefined
  if (!doc) return null
  const file = toMyFile(doc, labelsOf(folders))
  if (!file) return null
  const folder = doc.folder
  return {
    ...file,
    description: typeof doc.description === 'string' ? doc.description : '',
    tagsText: typeof doc.tagsText === 'string' ? doc.tagsText : '',
    folderId:
      folder === null || folder === undefined
        ? null
        : String(typeof folder === 'object' ? (folder as { id: unknown }).id : folder),
    filename: typeof doc.filename === 'string' ? doc.filename : '',
  }
}
