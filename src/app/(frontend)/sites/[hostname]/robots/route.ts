import { getTenantByHostname } from '@/content/tenants'
import { buildRobotsTxt, indexingAllowed, siteOrigin } from '@/lib/seo'

/**
 * `robots.txt`, per tenant (`01` §3 item 13).
 *
 * Reached only through the proxy's rewrite (src/proxy.ts), so `hostname` is the normalized
 * request Host. Cached like a page: the tenant lookup runs at build or revalidate time, never
 * per crawler (`02` §5). No Payload import — the boundary holds for route handlers too.
 */
export const revalidate = 3600

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hostname: string }> },
) {
  const tenant = await getTenantByHostname(decodeURIComponent((await params).hostname))

  // An unknown host has no site to describe. Never a default tenant's answer (`02` §4.1).
  if (!tenant) return new Response('Not found', { status: 404 })

  return new Response(
    buildRobotsTxt({
      origin: siteOrigin(tenant.hostname),
      indexable: indexingAllowed(process.env),
    }),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  )
}
