import { localizedPath } from '@/lib/locales'
import { NEWS_PATH, toNewsItems } from '@/lib/post-url'

import { listPosts } from './posts'
import type { ContentContext, FeedBlock, PageBlock, ResolvedPageBlock } from './types'

/**
 * THE RESOLVE PASS (Jason, 2026-10-28; `03` §3.2).
 *
 * ============================================================================
 * STORED SETTINGS IN, READY-TO-RENDER BLOCKS OUT. ON THE PAYLOAD SIDE.
 * ============================================================================
 *
 * A block never fetches (CLAUDE.md rule 1), so a block whose content is an editor-configured
 * query — a news feed now; a staff list, a document list, a gallery later — gets its data here,
 * between the pure mapper (`toPageBlocks`, which the migration runs with no CMS) and the
 * renderer (`BlockList`, which accepts only `ResolvedPageBlock`s, so skipping this does not
 * compile).
 *
 * Finalsite's post element is the same idea — a saved board/tag/count query rendered on the
 * server — with the query moved out of the component into the content layer.
 *
 * EMPTINESS IS DECIDED HERE: a data block with nothing to show is dropped, so no heading sits
 * over an empty box (Jason, 2026-10-28). Runs at build or revalidate time, never per visitor.
 */

type Options = {
  /** `NEXT_PUBLIC_SERVER_URL` — how a shared announcement links to its home site (`postHref`). */
  serverUrl: string
}

const resolveFeed = async (ctx: ContentContext, block: FeedBlock, { serverUrl }: Options) => {
  const posts = await listPosts(ctx, { boards: block.boards, tags: block.tags, limit: block.limit })
  if (posts.length === 0) return null
  return {
    kind: 'feed' as const,
    id: block.id,
    heading: block.heading,
    items: toNewsItems(posts, { siteTenantId: ctx.tenant.id, locale: ctx.locale, serverUrl }),
    moreHref: localizedPath(NEWS_PATH, ctx.locale),
  }
}

export const resolvePageBlocks = async (
  ctx: ContentContext,
  blocks: readonly PageBlock[],
  options: Options,
): Promise<ResolvedPageBlock[]> => {
  const resolved = await Promise.all(
    blocks.map(async (block): Promise<ResolvedPageBlock | null> => {
      switch (block.kind) {
        case 'feed':
          return resolveFeed(ctx, block, options)
        case 'columns':
          // A column's data blocks — a feed in a column — resolve as a page's do.
          return {
            ...block,
            columns: await Promise.all(
              block.columns.map(async (column) => ({
                heading: column.heading,
                blocks: await resolvePageBlocks(ctx, column.blocks, options),
              })),
            ),
          }
        default:
          return block
      }
    }),
  )
  return resolved.filter((block): block is ResolvedPageBlock => block !== null)
}
