import { getPayload } from 'payload'

import config from '@payload-config'

import { toSiteSettings } from './site-settings'
import type { ContentContext, SiteSettings } from './types'

/**
 * Settings lookup (`03` §5).
 *
 * ============================================================================
 * THIS FILE IS ON THE PAYLOAD SIDE OF THE BOUNDARY.
 * It may import the SDK. It returns DD2 domain types and nothing else.
 * ============================================================================
 *
 * Runs at build or revalidate time, never per visitor (`02` §5).
 */

/**
 * A tenant's settings. The defaults — never null — when the tenant has no row.
 *
 * `overrideAccess: true` for the reason `getNavigation` gives, which makes the `tenant`
 * clause the ONLY scoping on this path.
 */
export const getSettings = async (ctx: Pick<ContentContext, 'tenant'>): Promise<SiteSettings> => {
  const payload = await getPayload({ config })

  const { docs } = await payload.find({
    collection: 'settings',
    where: { tenant: { equals: ctx.tenant.id } },
    limit: 1,
    /**
     * One level, for the logos and thumbnails (Jason, 2026-11-18): each is a library file, and
     * its address, size and alt text are on that file. `toImageAsset` reads only those.
     */
    depth: 1,
    overrideAccess: true,
  })

  return toSiteSettings(docs[0])
}
