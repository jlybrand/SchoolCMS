import type { CollectionAfterChangeHook } from 'payload'

import { relationshipIdOf } from '@/access/predicates'

/**
 * Revalidate a school's public site when one of its pages is published (`05` Phase 4 exit:
 * "it goes live within seconds"; `02` §5).
 *
 * Public pages are ISR with `revalidate = 3600`. Without this an approved page could take an
 * hour to appear — and on a closure day, an hour of the old notice is a safety problem.
 *
 * SCOPE: the owning school's whole site, layout-deep (`/sites/{hostname}`, every locale and path
 * beneath it). Not just the page's own path, because its title also appears in that school's
 * menus, section lists and sitemap. Not every tenant, because over-purging all 28 warm caches is
 * the other failure `src/lib/cache-tags.ts` warns about. The per-document tags there are the
 * finer-grained version, for when reads are tag-cached; nothing reads through tags yet.
 *
 * A DRAFT save revalidates nothing — the public site has not changed. That includes every
 * autosave.
 *
 * NEVER FAILS THE WRITE. Outside a Next request (the seed, the integration suite) Next's
 * revalidation throws; a publish that succeeded must not be reported as failed because a cache
 * could not be told. The error is logged, and the hourly ISR remains the floor.
 *
 * Cloudflare's edge cache is not purged here: the CDN integration is not built yet (`09` §4.2).
 */

export type Revalidate = (path: string, type: 'layout' | 'page') => void | Promise<void>

export type RevalidateDeps = {
  revalidate: Revalidate
  hostnameFor: (
    tenantId: string,
    req: Parameters<CollectionAfterChangeHook>[0]['req'],
  ) => Promise<string | null>
}

/**
 * Next's own wording when revalidation is called with no request to revalidate for — the seed,
 * the integration suite. Expected there, so it is not an error; anything else is.
 */
const OUTSIDE_NEXT = /static generation store missing/

/** The rewrite target root for one school — see `src/proxy.ts`. */
export const tenantSitePath = (hostname: string): string => `/sites/${encodeURIComponent(hostname)}`

export const makeRevalidateOnPublish =
  ({ revalidate, hostnameFor }: RevalidateDeps): CollectionAfterChangeHook =>
  async ({ doc, req }) => {
    if ((doc as { _status?: unknown })._status !== 'published') return doc

    try {
      const tenantId = relationshipIdOf((doc as { tenant?: unknown }).tenant as never)
      const hostname = tenantId === null ? null : await hostnameFor(tenantId, req)
      if (!hostname) {
        req.payload.logger.error(
          `revalidateOnPublish: no hostname for tenant ${String(tenantId)} of page ${String(doc.id)}; nothing revalidated`,
        )
        return doc
      }
      await revalidate(tenantSitePath(hostname), 'layout')
    } catch (err) {
      if (OUTSIDE_NEXT.test((err as Error).message)) {
        req.payload.logger.debug(`revalidateOnPublish: not in a Next request; skipped`)
        return doc
      }
      req.payload.logger.error(
        `revalidateOnPublish: could not revalidate page ${String(doc.id)}: ${(err as Error).message}`,
      )
    }
    return doc
  }

/** The hostname of a tenant, read as the platform (it is routing configuration, not content). */
export const tenantHostname: RevalidateDeps['hostnameFor'] = async (tenantId, req) => {
  const tenant = await req.payload.findByID({
    collection: 'tenants',
    id: tenantId,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const hostname = (tenant as { hostname?: unknown } | null)?.hostname
  return typeof hostname === 'string' && hostname !== '' ? hostname : null
}
