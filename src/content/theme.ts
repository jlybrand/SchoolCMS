import { getPayload } from 'payload'

import config from '@payload-config'

import { toTheme } from './theme-tokens'
import type { ContentContext, Theme } from './types'

/**
 * Theme lookup (`03` §5, `02` §4.4).
 *
 * ============================================================================
 * THIS FILE IS ON THE PAYLOAD SIDE OF THE BOUNDARY.
 * It may import the SDK. It returns DD2 domain types and nothing else.
 * ============================================================================
 *
 * Runs at build or revalidate time, never per visitor (`02` §5).
 */

/**
 * A tenant's token overrides. No overrides — never null — when the tenant has no row, or has
 * one whose palette fails contrast (`toTheme`): both render the platform's default palette.
 *
 * `overrideAccess: true` for the reason `getNavigation` gives, which makes the `tenant`
 * clause the ONLY scoping on this path.
 */
export const getTheme = async (ctx: Pick<ContentContext, 'tenant'>): Promise<Theme> => {
  const payload = await getPayload({ config })

  const { docs } = await payload.find({
    collection: 'theme',
    where: { tenant: { equals: ctx.tenant.id } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  return toTheme(docs[0])
}
