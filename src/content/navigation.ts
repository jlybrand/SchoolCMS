import { getPayload } from 'payload'

import config from '@payload-config'

import { toNavigation } from './menus'
import type { ContentContext, Navigation } from './types'

/**
 * Menu lookup (`03` §5, `02` §11).
 *
 * ============================================================================
 * THIS FILE IS ON THE PAYLOAD SIDE OF THE BOUNDARY.
 * It may import the SDK. It returns DD2 domain types and nothing else.
 * ============================================================================
 *
 * Runs at build or revalidate time, never per visitor (`02` §5).
 */

/**
 * A tenant's menus. Empty menus — never null — when the tenant has no row, so a new site
 * renders a header with its name in it rather than failing on the day it is created
 * (`09` §7: adding a tenant is data, not DevOps).
 *
 * `overrideAccess: true` because this is the platform rendering its own site: the collection
 * is district-only by access, and an anonymous visitor's page still needs its header. That
 * makes the `tenant` clause below the ONLY scoping on this path — the access functions are
 * not doing it here.
 *
 * No published/draft filter, unlike `pages`: `navigation` has no drafts. A saved menu is a
 * live menu.
 */
export const getNavigation = async (ctx: ContentContext): Promise<Navigation> => {
  const payload = await getPayload({ config })

  const { docs } = await payload.find({
    collection: 'navigation',
    where: { tenant: { equals: ctx.tenant.id } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  return toNavigation(docs[0])
}
