import { getPayload } from 'payload'

import config from '@payload-config'

import { postPath } from '@/lib/post-url'

import { listPagePathIndex } from './pages'
import { toPost } from './post-mapper'
import { feedConstraint, type FeedFilter } from './syndication'
import type { ContentContext, Post } from './types'

/**
 * News and announcements for one site (`02` §6, §11).
 *
 * ============================================================================
 * THIS FILE IS ON THE PAYLOAD SIDE OF THE BOUNDARY.
 * It may import the SDK. It returns DD2 domain types and nothing else.
 * ============================================================================
 *
 * THE ONE CROSS-TENANT READ (`03` §6.4 invariant 3). A site's posts are its own plus those
 * syndicated to it, and the query says so in two halves that are both required:
 *
 *   - `syndicationConstraint` — which tenants' posts reach this one (src/content/syndication.ts);
 *   - published AND public — stated there too, because access is overridden on this path (the
 *     platform rendering its own site, as in `pages.ts`).
 *
 * Both are in `feedConstraint`, which then narrows by the feed's boards and tags — a filter can
 * only take posts away (Jason, 2026-10-28).
 *
 * Drop the first and every school shows every school's news; drop the second and a syndicated
 * DRAFT is on 28 sites. tests/integration/content-layer.test.ts proves each half.
 *
 * Runs at build or revalidate time, never per visitor (`02` §5).
 */

/** A feed shows a handful; a news index pages. Nothing asks for more than this at once. */
const MAX_POSTS = 100

type PayloadClient = Awaited<ReturnType<typeof getPayload>>

/** The home site's hostname for each post, in one read. */
const withHomes = async (payload: PayloadClient, posts: Post[]): Promise<Post[]> => {
  const ids = [...new Set(posts.map((post) => post.tenantId))]
  if (ids.length === 0) return posts
  const { docs } = await payload.find({
    collection: 'tenants',
    where: { id: { in: ids } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    select: { hostname: true },
  })
  const hosts = new Map(docs.map((t) => [String(t.id), t.hostname]))
  return posts.map((post) => ({ ...post, homeHostname: hosts.get(post.tenantId) ?? null }))
}

/** A site's own posts, published and public. Shared posts are listed elsewhere, never paged. */
const ownPublic = (ctx: ContentContext) => ({
  and: [
    { tenant: { equals: ctx.tenant.id } },
    { _status: { equals: 'published' } },
    { visibility: { equals: 'public' } },
  ],
})

/**
 * The announcement at `/news/{slug}` on this site, or null.
 *
 * ITS HOME SITE ONLY (Jason, 2026-10-28). A post shared here is listed here and links home, so
 * there is one address per announcement — one cached page, one search result, and no clash
 * with this site's own post of the same slug. A draft, a staff-only post and a missing one are
 * all null, and 404 alike (`03` §6.4).
 */
export const getPostBySlug = async (ctx: ContentContext, slug: string): Promise<Post | null> => {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'posts',
    where: { and: [...ownPublic(ctx).and, { slug: { equals: slug } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const post = toPost(docs[0], await listPagePathIndex(ctx))
  if (!post) return null
  return { ...post, homeHostname: ctx.tenant.hostname }
}

/** Every page path of this site's own published, public posts — for its sitemap. */
export const listPostPaths = async (ctx: ContentContext): Promise<string[]> => {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'posts',
    where: ownPublic(ctx),
    pagination: false,
    depth: 0,
    overrideAccess: true,
    select: { slug: true },
  })
  return docs
    .map((doc) => (typeof doc.slug === 'string' && doc.slug !== '' ? postPath(doc.slug) : null))
    .filter((path): path is string => path !== null)
}

export const listPosts = async (
  ctx: ContentContext,
  { limit = 10, ...filter }: { limit?: number } & FeedFilter = {},
): Promise<Post[]> => {
  const payload = await getPayload({ config })

  const { docs } = await payload.find({
    collection: 'posts',
    where: feedConstraint(ctx.tenant.id, filter),
    // Newest first; the id breaks ties so two posts dated alike never swap between builds.
    sort: ['-publishedDate', '-id'],
    limit: Math.max(1, Math.min(limit, MAX_POSTS)),
    depth: 0,
    overrideAccess: true,
  })

  return withHomes(
    payload,
    docs.map((doc) => toPost(doc)).filter((post): post is Post => post !== null),
  )
}
