import { getPagePathById } from '@/content/pages'
import { localizedPath } from '@/lib/locales'
import { parsePermalinkId } from '@/lib/permalink'

import { resolveSite, type SiteParams } from '../../../site'

/**
 * A page's permalink, `/dd2/pages/<id>` (Jason, 2026-10-29): redirects to wherever the page is now, so
 * a link that uses it survives the page being renamed or moved.
 *
 * Cached like a page (`02` §5) — the lookup runs at build or revalidate time, never per
 * visitor. Publishing any page on the site purges it with the rest of the site (`src/collections/
 * hooks/revalidate-on-publish.ts`), and a publish is the only way a page's path changes.
 *
 * 302, NOT 301. The destination is exactly the thing that changes; a browser keeps a 301 for
 * good and would send a returning visitor to the page's OLD address.
 *
 * The Location is a path, not an absolute URL: the request reached here by a rewrite, and the
 * visitor's own host is the one the redirect must stay on.
 */
export const revalidate = 3600

const NOT_FOUND = () => new Response('Not found', { status: 404 })

export async function GET(
  _request: Request,
  { params }: { params: Promise<SiteParams & { id: string }> },
) {
  const { id: raw, ...siteParams } = await params
  const id = parsePermalinkId(raw)
  if (id === null) return NOT_FOUND()

  const site = await resolveSite(siteParams)
  if (!site) return NOT_FOUND()

  /**
   * Missing, draft, staff-only and another site's page all 404 alike — a different answer for
   * any of them would tell a stranger which ids exist (`03` §6.4).
   */
  const path = await getPagePathById(site.ctx, id)
  if (path === null) return NOT_FOUND()

  return new Response(null, {
    status: 302,
    headers: { Location: localizedPath(path, site.ctx.locale) },
  })
}
