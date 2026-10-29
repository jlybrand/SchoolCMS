import { listPagePaths } from '@/content/pages'
import { listPostPaths } from '@/content/posts'
import { getSettings } from '@/content/settings'
import { getTenantByHostname } from '@/content/tenants'
import { DEFAULT_LOCALE } from '@/lib/locales'
import { NEWS_PATH } from '@/lib/post-url'
import { buildSitemapXml, indexingAllowed, siteOrigin } from '@/lib/seo'

/**
 * `sitemap.xml`, per tenant, with locale variants (`01` §3 item 13, `08` §5).
 *
 * Built from `listPagePaths`, which is already the definition of "a page with a reachable
 * URL": published, public, with a published parent chain. A draft or a staff-only page is
 * absent from it, so it is absent from here, and the sitemap cannot become the place
 * unannounced content is listed (`03` §6.4).
 *
 * A Route Handler rather than Next's `sitemap.ts` convention, which has no way to emit the
 * per-locale alternates. The folder is `sitemap`, not `sitemap.xml`, so Next does not mistake
 * it for that convention; the proxy maps the public URL onto it (src/proxy.ts).
 */
export const revalidate = 3600

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hostname: string }> },
) {
  const tenant = await getTenantByHostname(decodeURIComponent((await params).hostname))
  if (!tenant) return new Response('Not found', { status: 404 })

  /**
   * No sitemap where indexing is off. `robots.txt` already says keep out and names no
   * sitemap; serving one anyway would hand a crawler that ignores robots the full URL list of
   * a staging site.
   */
  if (!indexingAllowed(process.env)) return new Response('Not found', { status: 404 })

  const ctx = { tenant, locale: DEFAULT_LOCALE }
  const pages = await listPagePaths(ctx)
  /**
   * The site's announcement list and its OWN announcements (Jason, 2026-10-28). A shared one is
   * in its home site's sitemap, where its address is — never in two.
   */
  const posts = await listPostPaths(ctx)
  // The same list the page route 404s against, so the sitemap never names a URL that is not one.
  const { enabledLocales } = await getSettings({ tenant })

  return new Response(
    buildSitemapXml({
      origin: siteOrigin(tenant.hostname),
      // A page hidden from search engines (Jason, 2026-10-29) is served but not listed.
      paths: [
        // A linked page is a redirect, which a sitemap must not list (Jason, 2026-10-29).
        ...pages
          // A reuse page's canonical is the district's, which lists it (Jason, 2026-10-29).
          .filter(
            ({ page }) =>
              !page.hideFromSearchEngines && page.redirect === null && page.reusedFrom === null,
          )
          .map(({ path }) => path),
        NEWS_PATH,
        ...posts,
      ],
      locales: enabledLocales,
    }),
    { headers: { 'content-type': 'application/xml; charset=utf-8' } },
  )
}
