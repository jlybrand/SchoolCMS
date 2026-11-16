import { getPayload } from 'payload'

import config from '@payload-config'

import { toDocumentItem } from './document-item'
import { toImageAsset } from './image-asset'
import type { DocumentItem, ImageAsset } from './types'

/**
 * A library image for a page (Jason, 2026-11-13) — read as the platform: files are public, the
 * library's access is for the dashboard. A missing file, or one that is not an image, is nothing,
 * and the block that wanted it is dropped. Runs at render and revalidate time with the page.
 */
export const getImageAsset = async (id: string): Promise<ImageAsset | null> => {
  const payload = await getPayload({ config })
  const doc = await payload.findByID({
    collection: 'resources',
    id,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })
  return toImageAsset(doc)
}

/**
 * Several library images at once — an announcement list's thumbnails (Jason, 2026-11-13) — in one
 * read, as id -> image. Ids that are missing or are not images are absent from the map.
 */
export const getImageAssets = async (
  ids: readonly string[],
): Promise<ReadonlyMap<string, ImageAsset>> => {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'resources',
    where: { and: [{ id: { in: unique } }, { kind: { equals: 'image' } }] },
    limit: unique.length,
    depth: 0,
    overrideAccess: true,
  })
  return new Map(
    docs.flatMap((doc) => {
      const asset = toImageAsset(doc)
      return asset ? [[String(doc.id), asset] as const] : []
    }),
  )
}

/** A folder holds a handful of forms, rarely more; a page lists at most this many. */
const MAX_DOCUMENTS = 200

/**
 * The documents in ONE library folder (Jason, 2026-11-16), A–Z by title, for a Document list.
 * Read as the platform — files are public — but only THIS site's: a stored folder id that points
 * at another site lists nothing (`03` §6.4). Not its subfolders; images in it are left out.
 */
export const listFolderDocuments = async (
  tenantId: string,
  folderId: string,
): Promise<DocumentItem[]> => {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'resources',
    where: {
      and: [
        { tenant: { equals: tenantId } },
        { folder: { equals: folderId } },
        { kind: { equals: 'document' } },
      ],
    },
    sort: 'title',
    limit: MAX_DOCUMENTS,
    depth: 0,
    overrideAccess: true,
  })
  return docs
    .map(toDocumentItem)
    .filter((d): d is DocumentItem => d !== null)
    .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }))
}
