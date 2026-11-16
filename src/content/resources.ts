import { getPayload } from 'payload'

import config from '@payload-config'

import { toImageAsset } from './image-asset'
import type { ImageAsset } from './types'

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
