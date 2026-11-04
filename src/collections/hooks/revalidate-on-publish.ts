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
  /**
   * The tenants whose sites show this document. Default: its own. An announcement's are every
   * site it is shared with (`syndicationTargets`).
   */
  targetsFor?: (
    doc: Record<string, unknown>,
    previousDoc: Record<string, unknown> | undefined,
    req: Parameters<CollectionAfterChangeHook>[0]['req'],
  ) => Promise<string[]>
  hostnameFor: (
    tenantId: string,
    req: Parameters<CollectionAfterChangeHook>[0]['req'],
  ) => Promise<string | null>
  /**
   * Whether the LIVE record is still published after a non-publishing write to a published
   * document. False means it was unpublished (Jason, 2026-10-29) and the site must be told now.
   * Without it, only publishes revalidate.
   */
  stillLive?: (
    doc: Record<string, unknown>,
    req: Parameters<CollectionAfterChangeHook>[0]['req'],
  ) => Promise<boolean>
}

/**
 * Next's own wording when revalidation is called with no request to revalidate for — the seed,
 * the integration suite. Expected there, so it is not an error; anything else is.
 */
const OUTSIDE_NEXT = /static generation store missing/

/** The rewrite target root for one school — see `src/proxy.ts`. */
export const tenantSitePath = (hostname: string): string => `/sites/${encodeURIComponent(hostname)}`

export const makeRevalidateOnPublish =
  ({ revalidate, hostnameFor, targetsFor, stillLive }: RevalidateDeps): CollectionAfterChangeHook =>
  async ({ doc, previousDoc, req }) => {
    if ((doc as { _status?: unknown })._status !== 'published') {
      /**
       * Not a publish. It is an UNPUBLISH only if the document was published and its live
       * record no longer is — a draft save over a published page leaves the live one standing,
       * and so does every autosave.
       */
      const wasPublished =
        (previousDoc as { _status?: unknown } | undefined)?._status === 'published'
      if (!wasPublished || !stillLive) return doc
      try {
        if (await stillLive(doc, req)) return doc
      } catch {
        return doc
      }
    }

    try {
      const own = relationshipIdOf((doc as { tenant?: unknown }).tenant as never)
      const targets = targetsFor
        ? await targetsFor(doc, previousDoc, req)
        : own === null
          ? []
          : [own]
      if (targets.length === 0) {
        req.payload.logger.error(
          `revalidateOnPublish: no tenant for ${String(doc.id)}; nothing revalidated`,
        )
        return doc
      }
      for (const tenantId of [...new Set(targets)]) {
        const hostname = await hostnameFor(tenantId, req)
        if (!hostname) {
          req.payload.logger.error(
            `revalidateOnPublish: no hostname for tenant ${tenantId} of ${String(doc.id)}; that site not revalidated`,
          )
          continue
        }
        await revalidate(tenantSitePath(hostname), 'layout')
      }
    } catch (err) {
      if (OUTSIDE_NEXT.test((err as Error).message)) {
        req.payload.logger.debug(`revalidateOnPublish: not in a Next request; skipped`)
        return doc
      }
      req.payload.logger.error(
        `revalidateOnPublish: could not revalidate ${String(doc.id)}: ${(err as Error).message}`,
      )
    }
    return doc
  }

type Shared = { tenant?: unknown; syndication?: unknown } | null | undefined

const reach = (doc: Shared, all: readonly string[]): string[] => {
  if (!doc) return []
  const own = relationshipIdOf(doc.tenant as never)
  const { scope, syndicatedTo } = (doc.syndication ?? {}) as {
    scope?: unknown
    syndicatedTo?: unknown
  }
  if (scope === 'district-wide') return [...all]
  const chosen =
    scope === 'selected' && Array.isArray(syndicatedTo)
      ? syndicatedTo.map((t) => relationshipIdOf(t as never)).filter((t): t is string => t !== null)
      : []
  return own === null ? chosen : [own, ...chosen]
}

/**
 * Every tenant whose site lists an announcement — its own and every site it is shared with
 * (`02` §6) — after this write AND before it, so a site it was just taken off stops listing it.
 * Pure; `all` is every tenant id.
 */
export const syndicationTargets = (
  doc: Shared,
  previous: Shared,
  all: readonly string[],
): string[] => [...new Set([...reach(doc, all), ...reach(previous, all)])]

/** Every tenant id, read as the platform — for an announcement shared with every school. */
export const allTenantIds = async (
  req: Parameters<CollectionAfterChangeHook>[0]['req'],
): Promise<string[]> => {
  const { docs } = await req.payload.find({
    collection: 'tenants',
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
    select: {},
  })
  return docs.map((d) => String(d.id))
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

/**
 * The sites a PAGE's publish revalidates: its own, and every site with a linked page pointing
 * at it (Jason, 2026-10-29) — their cached redirect names this page's path, which this publish
 * may just have changed. Read as the platform; one query.
 */
export const pageRevalidationTargets: NonNullable<RevalidateDeps['targetsFor']> = async (
  doc,
  _previousDoc,
  req,
) => {
  const own = relationshipIdOf((doc as { tenant?: unknown }).tenant as never)
  const { docs } = await req.payload.find({
    collection: 'pages',
    where: {
      or: [{ linkTarget: { equals: doc.id } }, { districtLinkTarget: { equals: doc.id } }],
    },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
    select: { tenant: true },
  })
  const linking = docs
    .map((d) => relationshipIdOf((d as { tenant?: unknown }).tenant as never))
    .filter((t): t is string => t !== null)
  return [...new Set([...(own === null ? [] : [own]), ...linking])]
}

/**
 * The live record of a document, read as the platform: still published? An unpublish leaves it
 * a draft; a draft save leaves it published. `draft: false` reads the record, not the newest
 * version.
 */
export const liveStillPublished =
  (collection: 'pages' | 'posts'): NonNullable<RevalidateDeps['stillLive']> =>
  async (doc, req) => {
    const live = await req.payload.findByID({
      collection,
      id: doc.id as string | number,
      draft: false,
      depth: 0,
      overrideAccess: true,
      req,
      select: { _status: true } as never,
    })
    return (live as { _status?: unknown } | null)?._status === 'published'
  }

/**
 * The announcements' revalidation, as `posts` registers it: live in seconds on EVERY site that
 * lists it — its own and each it is shared with, before and after the write
 * (`syndicationTargets`), so a site it was taken off stops listing it. Named so the schedule job
 * (`src/collections/endpoints/post-schedule.ts`) can re-run it when a post stops being featured,
 * which is not a write.
 */
export const revalidatePost = makeRevalidateOnPublish({
  revalidate: async (path, type) => {
    const { revalidatePath } = await import('next/cache')
    revalidatePath(path, type)
  },
  hostnameFor: tenantHostname,
  targetsFor: async (doc, previousDoc, req) =>
    syndicationTargets(doc, previousDoc, await allTenantIds(req)),
  // An unpublished announcement leaves every site that lists it now, not in an hour.
  stillLive: liveStillPublished('posts'),
})
