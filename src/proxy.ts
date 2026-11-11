import { NextResponse, type NextRequest } from 'next/server'

import { localeFromPathname } from '@/lib/locales'
import { normalizeHostname } from '@/lib/tenant'

/**
 * Edge proxy — tenant and locale routing (`02` §4.1, `08` §5).
 *
 * Next 16 renamed this file convention from `middleware` to `proxy`; the design docs call
 * it "edge middleware" (`02` §3, §4.1) and mean this.
 *
 * Rewrites every public request to `/sites/{hostname}/{locale}/{path}`.
 *
 * WHY THE REWRITE. Next caches by pathname, not by Host. Twenty-eight tenants served from
 * one deployment would therefore share one cache entry per path, and `/calendar` for one
 * school would be served from another school's cached artifact — a tenant leak that no
 * access function could catch, because it happens in the CDN rather than in the database.
 * Folding hostname and locale into the path makes the cache key correct by construction.
 *
 * WHAT THIS DOES NOT DO. It does not touch Payload. Middleware runs on every request, and
 * the database is never in the public request path (`02` §5); it is also on the wrong side
 * of the content-access boundary (`02` §11). Hostname is passed through as-is and resolved
 * to a tenant inside the server component, at build/revalidate time, via `src/content/*`.
 * An unknown host 404s there rather than falling back to a default tenant (`02` §4.1).
 */
/**
 * Public path -> the route under `/sites/[hostname]/` that answers it.
 *
 * The targets have NO EXTENSION, deliberately. Next special-cases a route named
 * `sitemap.xml` or `robots.txt` as one of its own metadata routes — it prerendered ours at
 * build with a placeholder hostname — and these are ordinary per-tenant Route Handlers that
 * should be treated as such.
 */
const TENANT_FILES: ReadonlyMap<string, string> = new Map([
  ['/robots.txt', 'robots'],
  ['/sitemap.xml', 'sitemap'],
])

/**
 * A calendar's iCal feed (Jason, 2026-11-11): `/calendars/<id>.ics` on the calendar's own site.
 * Beside `[locale]`, like the two files above — a feed is not translated — and digits only, so a
 * near miss is an ordinary page path that 404s as one. The route checks the calendar is this
 * site's.
 */
const CALENDAR_FEED = /^\/calendars\/(\d+)\.ics$/

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const hostname = normalizeHostname(request.headers.get('host'))
  if (!hostname) {
    // No usable Host header. Nothing can be resolved; refuse rather than guess.
    return new NextResponse('Not found', { status: 404 })
  }

  /**
   * The two per-tenant FILES (`01` §3 item 13). One URL on 28 hosts with 28 answers — a
   * school's sitemap lists that school's pages — so they need the same Host-to-tenant rewrite
   * a page gets. They sit beside `[locale]` rather than under it: there is one of each per
   * site, not one per language, and the sitemap is what lists the languages.
   *
   * Exact matches on the unprefixed path only. `/es/sitemap.xml` is not a thing, so it falls
   * through as an ordinary page path and 404s as one.
   */
  const tenantFile = TENANT_FILES.get(pathname)
  if (tenantFile !== undefined) {
    const url = request.nextUrl.clone()
    url.pathname = `/sites/${encodeURIComponent(hostname)}/${tenantFile}`
    return NextResponse.rewrite(url)
  }

  const feed = CALENDAR_FEED.exec(pathname)
  if (feed) {
    const url = request.nextUrl.clone()
    url.pathname = `/sites/${encodeURIComponent(hostname)}/calendar-feed/${feed[1]}`
    return NextResponse.rewrite(url)
  }

  const { locale, rest } = localeFromPathname(pathname)

  /**
   * The rewrite target is a real, reachable route (App Router treats `_`-prefixed folders
   * as private and excludes them from routing, so it cannot be hidden by naming). Refuse
   * direct access so `/sites/<anything>` cannot be used to request another tenant's cached
   * artifact by path.
   */
  if (pathname === '/sites' || pathname.startsWith('/sites/')) {
    return new NextResponse('Not found', { status: 404 })
  }

  const url = request.nextUrl.clone()
  url.pathname = `/sites/${encodeURIComponent(hostname)}/${locale}${rest === '/' ? '' : rest}`

  // Rewrites do not re-enter the proxy, so this does not loop.
  return NextResponse.rewrite(url)
}

export const config = {
  /**
   * Public pages only. Deliberately excluded:
   *   - `/admin` and `/api` — Payload's own mount point (`src/app/(payload)`)
   *   - `/_next` — framework internals
   *   - static assets, matched by a trailing file extension only
   *
   * `/sites/*` is deliberately NOT excluded: it must reach the proxy so direct requests to
   * the rewrite target can be refused above.
   */
  /**
   * Anchor the asset exclusion to a real file extension at the END of the path.
   *
   * The obvious `.*\\..*` form is WRONG here and was a live hole: the rewrite target
   * embeds a hostname, so `/sites/b.localhost/en` contains a dot, bypassed the proxy
   * entirely, and the direct-access guard above never ran — leaving another tenant's
   * cached artifact requestable by path. Caught by
   * tests/e2e/tenant-routing.spec.ts.
   */
  matcher: [
    '/((?!admin|api|_next|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|css|js|mjs|map|txt|xml|json|woff|woff2|ttf|otf)$).*)',
    /**
     * Named, because the pattern above skips `.txt` and `.xml` as static assets — and these
     * two are per-tenant routes, not files.
     */
    '/robots.txt',
    '/sitemap.xml',
    /**
     * ALL of `/sites/*`, extension or not. The first pattern lets `/sites/b.localhost/en`
     * through to be refused, but anything under `/sites` that ENDS in a listed extension
     * would skip the proxy as an "asset" and never meet the direct-access refusal — the same
     * hole described above, one careless route name away. Closed for the whole prefix rather
     * than left to whoever names the next route.
     */
    '/sites/:path*',
  ],
}
