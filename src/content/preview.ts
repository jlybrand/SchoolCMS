import { getPayload, type TypedUser } from 'payload'

import config from '@payload-config'

import { toPageBlocks } from './blocks'
import { listPagePathIndex, resolvePreviewLink } from './pages'
import { getTenantByHostname } from './tenants'
import type { PageBlock, PageRedirect } from './types'

/**
 * LIVE PREVIEW (Jason, 2026-11-10): the page being edited, beside its form, in the site's own
 * header, theme and components. `src/app/(preview)/admin-preview/pages/[id]` renders it; the
 * admin's Live Preview panel frames that route.
 *
 * It shows the DRAFT — the newest version, what the editor is typing — so it is read AS the
 * person previewing, with `overrideAccess: false`: the same access functions as every other read
 * decide what they see. A school manager previews their own school's pages and nobody else's;
 * nobody signed in previews nothing (`03` §6.4, CLAUDE.md rule 2).
 */

/** Who is previewing — opaque outside this file, so the rendering layer never handles a user. */
export type Previewer = { readonly user: TypedUser } & { readonly __previewer: never }

/** The person signed in on this request (the admin's session cookie), or null. */
export const getPreviewer = async (headers: Headers): Promise<Previewer | null> => {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers })
  return user ? ({ user } as Previewer) : null
}

export type PagePreview = {
  /** The page's site, so the route can frame it in that site's header, theme and footer. */
  hostname: string
  title: string
  layout: PageBlock[]
  /**
   * A LINKED page (Jason, 2026-11-19): what a visitor gets instead of its own sections — a reuse
   * page's title and layout above are the district page's; a redirect or a link to nothing live
   * has no layout, and the route says where visitors go (or that they find nothing). Null when
   * the page is not linked.
   */
  link:
    | { kind: 'reuse'; from: PageRedirect }
    | { kind: 'redirect'; to: PageRedirect }
    | { kind: 'unresolved' }
    | null
}

/** A page's newest version, as `previewer` may see it, or null. */
export const getPagePreview = async (
  id: string,
  previewer: Previewer | null,
): Promise<PagePreview | null> => {
  if (!previewer || !/^\d+$/.test(id)) return null
  const payload = await getPayload({ config })
  const doc = await payload
    .findByID({
      collection: 'pages',
      id,
      draft: true,
      depth: 1,
      user: previewer.user,
      overrideAccess: false,
    })
    .catch(() => null)
  if (!doc) return null

  const owner = doc.tenant as { hostname?: unknown } | number | null
  const hostname = owner && typeof owner === 'object' ? owner.hostname : null
  if (typeof hostname !== 'string') return null
  const tenant = await getTenantByHostname(hostname)
  if (!tenant) return null

  const ctx = { tenant, locale: 'en' } as const
  const link = await resolvePreviewLink(ctx, doc)
  if (link?.kind === 'reuse')
    return {
      hostname,
      title: link.title,
      layout: link.layout,
      link: { kind: 'reuse', from: link.from },
    }
  if (link) return { hostname, title: doc.title, layout: [], link }
  return {
    hostname,
    title: doc.title,
    layout: toPageBlocks(doc.layout, await listPagePathIndex(ctx)),
    link: null,
  }
}
