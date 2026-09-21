import { listPagePaths } from '@/content/pages'
import { getTenantByHostname } from '@/content/tenants'
import { DEFAULT_LOCALE, ALL_LOCALES } from '@/lib/locales'
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

  const pages = await listPagePaths({ tenant, locale: DEFAULT_LOCALE })

  return new Response(
    buildSitemapXml({
      origin: siteOrigin(tenant.hostname),
      paths: pages.map(({ path }) => path),
      locales: ALL_LOCALES,
    }),
    { headers: { 'content-type': 'application/xml; charset=utf-8' } },
  )
}
