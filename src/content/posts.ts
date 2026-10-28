import { getPayload } from 'payload'

import config from '@payload-config'

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

  return docs.map(toPost).filter((post): post is Post => post !== null)
}
