import type { Payload, PayloadRequest } from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { CONTENT_ACTIONS, STALE_DAYS, keyPageKind, type KeyPage } from '@/lib/dashboard'
import { DAY } from '@/lib/queue-age'

/**
 * The district dashboard's reads (`04` §3.1). Every read runs AS THE USER (`overrideAccess:
 * false`), so the panels show what the viewer's access allows and nothing wider — the dashboard
 * only renders for a district admin, but it does not lean on that.
 *
 * "Published" content is the main row with `_status: published`: with drafts on, the main row of
 * a published document holds its live version (see `src/admin/Approvals/queue-data.ts`), so its
 * `updatedAt` is when it last went live.
 */

type User = PayloadRequest['user']
type Row = Record<string, unknown>

const asUser = (user: User) => ({ user, overrideAccess: false, depth: 0 }) as const

/** Everything waiting for approval, with when it was sent. */
export const findWaiting = async (payload: Payload, user: User) => {
  const reads = await Promise.all(
    (['pages', 'posts'] as const).map((collection) =>
      payload.find({
        collection,
        ...asUser(user),
        draft: true,
        pagination: false,
        where: { reviewState: { equals: 'submitted' } },
        select: { submittedAt: true },
      }),
    ),
  )
  return reads.flatMap((r) => r.docs as Row[])
}

/** Every site, by name. */
export const findSites = async (payload: Payload, user: User) =>
  (
    await payload.find({
      collection: 'tenants',
      ...asUser(user),
      pagination: false,
      sort: 'name',
      select: { name: true },
    })
  ).docs.map((doc) => ({ id: String(doc.id), name: String(doc.name ?? doc.id) }))

/**
 * Site id → when its newest published page or announcement went live. Sites changed within the
 * window are found in one read per collection; only the rest are looked up one by one — they are
 * the few the panel names.
 */
export const findLastPublished = async (
  payload: Payload,
  user: User,
  siteIds: readonly string[],
  now: Date,
): Promise<Map<string, string>> => {
  const since = new Date(now.getTime() - STALE_DAYS * DAY).toISOString()
  const last = new Map<string, string>()
  const note = (doc: Row) => {
    const site = relationshipIdOf(doc.tenant as never)
    const at = typeof doc.updatedAt === 'string' ? doc.updatedAt : null
    if (site === null || at === null) return
    if ((last.get(site) ?? '') < at) last.set(site, at)
  }

  const recent = await Promise.all(
    (['pages', 'posts'] as const).map((collection) =>
      payload.find({
        collection,
        ...asUser(user),
        pagination: false,
        where: { _status: { equals: 'published' }, updatedAt: { greater_than: since } },
        select: { tenant: true, updatedAt: true },
      }),
    ),
  )
  recent.forEach((r) => (r.docs as Row[]).forEach(note))

  const quiet = siteIds.filter((id) => !last.has(id))
  const newest = await Promise.all(
    quiet.flatMap((site) =>
      (['pages', 'posts'] as const).map((collection) =>
        payload.find({
          collection,
          ...asUser(user),
          limit: 1,
          sort: '-updatedAt',
          where: { _status: { equals: 'published' }, tenant: { equals: site } },
          select: { tenant: true, updatedAt: true },
        }),
      ),
    ),
  )
  newest.forEach((r) => (r.docs as Row[]).forEach(note))
  return last
}

/** The published key pages — each site's front page — with their site's name. */
export const findKeyPages = async (
  payload: Payload,
  user: User,
  siteNames: ReadonlyMap<string, string>,
): Promise<KeyPage[]> => {
  const { docs } = await payload.find({
    collection: 'pages',
    ...asUser(user),
    pagination: false,
    where: {
      and: [
        { _status: { equals: 'published' } },
        { slug: { equals: 'home' } },
        { parent: { exists: false } },
      ],
    },
    select: {
      title: true,
      slug: true,
      parent: true,
      tenant: true,
      updatedAt: true,
    },
  })
  return (docs as Row[]).flatMap((doc) => {
    const kind = keyPageKind(doc)
    const site = relationshipIdOf(doc.tenant as never)
    if (kind === null || typeof doc.updatedAt !== 'string') return []
    return [
      {
        id: doc.id as number | string,
        site: (site && siteNames.get(site)) ?? 'Unknown site',
        title: typeof doc.title === 'string' && doc.title !== '' ? doc.title : 'Untitled page',
        kind,
        updatedAt: doc.updatedAt,
      },
    ]
  })
}

/** The newest content entries in the audit trail — no sign-ins or account changes. */
export const findRecentActivity = async (payload: Payload, user: User, limit = 10) =>
  (
    await payload.find({
      collection: 'audit-events',
      ...asUser(user),
      limit,
      sort: '-createdAt',
      where: { action: { in: [...CONTENT_ACTIONS] } },
      select: {
        action: true,
        contentType: true,
        documentId: true,
        documentTitle: true,
        actorLabel: true,
        tenant: true,
        createdAt: true,
        autoApproved: true,
      },
    })
  ).docs as Row[]
