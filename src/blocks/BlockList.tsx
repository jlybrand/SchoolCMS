import { BLOCK_HEADING_LEVEL, clampHeadingLevel } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import { Stack } from '@/components/Stack'
import type { PageLink, ResolvedPageBlock } from '@/content/types'

import { Accordion } from './Accordion'
import { Calendar } from './Calendar'
import { CallToAction } from './CallToAction'
import { CardGrid } from './CardGrid'
import { ChildPageNav } from './ChildPageNav'
import { Columns } from './Columns'
import { Divider } from './Divider'
import { Embed } from './Embed'
import { NewsFeed } from './NewsFeed'
import { RichTextBlock } from './RichTextBlock'

/**
 * Renders a composed page's `layout` (`03` §3).
 *
 * ============================================================================
 * THE REGISTRY IS AN EXHAUSTIVE SWITCH, ON PURPOSE.
 * Adding a member to `PageBlock` without a renderer is a COMPILE ERROR.
 * ============================================================================
 *
 * A lookup table keyed by `kind` would be shorter and would fail differently: a missing entry
 * would render nothing, silently, on a published page — the block would be in the database,
 * visible in the admin, and absent from the site. The `never` check below turns that into a
 * typecheck failure at the moment the union grows, which is the only moment anyone is looking.
 *
 * WHAT THIS OWNS THAT NO BLOCK DOES:
 *
 *   - **The heading level every block starts from.** `BLOCK_HEADING_LEVEL` is one step below
 *     the page title, and it is the same for every block regardless of position. That is what
 *     makes "an editor cannot produce a heading-order violation by reordering" true: reordering
 *     cannot change a level that does not depend on order (`03` §3.2, `07` §3).
 *   - **The space between blocks**, via `Stack` — so no block ships a trailing margin that
 *     collapses differently depending on what an editor put after it.
 *
 * No Payload import, by construction and by lint: this is `src/blocks/`, one of the guarded
 * directories (CLAUDE.md rule 1, `tests/unit/guardrails/content-boundary.test.ts`).
 */

export type BlockListProps = {
  /**
   * RESOLVED blocks only (Jason, 2026-10-28). A page's stored layout must go through
   * `resolvePageBlocks` first — a stored feed is not a `ResolvedPageBlock`, so passing the layout
   * straight through does not compile.
   */
  readonly blocks: readonly ResolvedPageBlock[]
  /**
   * The current page's children, for `ChildPageNav` (`03` §3.3, decided 2026-08-28).
   *
   * REQUIRED, AND NOT DEFAULTED TO EMPTY. A default would let a template that forgot it render
   * a section menu as nothing — present in the admin, blank on the published page — which is
   * the silent failure the exhaustive switch below exists to prevent. Making it required moves
   * that back to a compile error. Most layouts pass `[]` and that is fine; passing it is the
   * point.
   *
   * Note what this is NOT: a general data bag for blocks. It is one field of the page being
   * rendered, forwarded. Blocks whose data is an editor-configured query (`FeedBlock` today;
   * `StaffList`, `DocumentList`, `Gallery` later) get theirs from the resolve pass
   * (`src/content/resolve-blocks.ts`), not from more entries here.
   */
  readonly childPages: readonly PageLink[]
  /**
   * The level a block's own heading becomes. Defaults to one below the page title.
   *
   * A prop for the same reason `RichText` has one: a layout rendered inside a named region is
   * already a step down the outline. Threaded rather than taken from context — these are
   * server components (`src/components/Heading/levels.ts`).
   */
  readonly baseLevel?: HeadingLevel
}

const Block = ({
  block,
  baseLevel,
  childPages,
}: {
  readonly block: ResolvedPageBlock
  readonly baseLevel: HeadingLevel
  readonly childPages: readonly PageLink[]
}) => {
  switch (block.kind) {
    case 'richText':
      return <RichTextBlock baseLevel={baseLevel} block={block} />
    case 'callToAction':
      return <CallToAction baseLevel={baseLevel} block={block} />
    case 'accordion':
      return <Accordion baseLevel={baseLevel} block={block} />
    case 'cardGrid':
      return <CardGrid baseLevel={baseLevel} block={block} />
    case 'childPageNav':
      // The only block handed anything beyond its own row — see `BlockListProps.childPages`.
      return <ChildPageNav baseLevel={baseLevel} block={block} pages={childPages} />
    case 'embed':
      // No heading, so no level to thread — the frame's title is an accessible name, not an
      // outline entry.
      return <Embed block={block} />
    case 'divider':
      // No heading, so no level to thread — see `Divider`.
      return <Divider />
    case 'feed':
      // Already resolved — its announcements arrived with it (`resolvePageBlocks`).
      return <NewsFeed baseLevel={baseLevel} block={block} />
    case 'calendar':
      // Already resolved — its events arrived with it (`resolvePageBlocks`).
      return <Calendar baseLevel={baseLevel} block={block} />
    case 'columns':
      // Its columns hold blocks: this list renders them, one level in (`columnLevels`).
      return (
        <Columns
          baseLevel={baseLevel}
          block={block}
          renderBlocks={(blocks, level) => (
            <BlockList baseLevel={level} blocks={blocks} childPages={childPages} />
          )}
        />
      )
    default: {
      /**
       * Unreachable while the switch is exhaustive. If a new block type makes this line fail
       * to compile, the fix is a `case`, never a cast — see the file header.
       */
      const exhaustive: never = block
      return exhaustive
    }
  }
}

export const BlockList = ({
  blocks,
  childPages,
  baseLevel = BLOCK_HEADING_LEVEL,
}: BlockListProps) => {
  /**
   * FLOORED AT `h2`, here and not in each block. `Heading` clamps to the 1-6 range but does
   * not refuse `h1` — it cannot, since the page title legitimately needs one. So a caller
   * passing `baseLevel={1}` would hand every block a second `h1` and give the page two.
   *
   * Doing it once here is the point: a block that had to remember this could forget, and the
   * claim in `03` §3.2 is that no block author has to remember anything about levels.
   * `RichText` floors its own for the same reason on the fixed-page path.
   */
  const resolved = clampHeadingLevel(Math.max(BLOCK_HEADING_LEVEL, baseLevel))

  /**
   * `ChildPageNav` is the one block the mapper cannot drop for being empty — its content is
   * the page's children rather than its own row, so emptiness is not knowable until here
   * (`src/content/blocks.ts`). It renders null in that case, and a null inside `Stack` is
   * still a flex item: it would take a gap on both sides and put a hole in the page.
   *
   * So the filter is about SPACING and belongs to the thing that owns spacing. The component
   * keeps its own guard for the same case, because it is exported and can be rendered
   * directly — the two answer different questions.
   */
  const visible = blocks.filter(
    (block) =>
      (block.kind !== 'childPageNav' || childPages.length > 0) &&
      // The resolve pass drops an empty feed; a directly-built one is filtered for the same reason.
      (block.kind !== 'feed' || block.items.length > 0) &&
      // An empty LIST is dropped the same way; a grid always shows (an empty month is a calendar).
      (block.kind !== 'calendar' || block.display === 'grid' || block.events.length > 0),
  )

  /**
   * A composed page with nothing to show renders nothing rather than an empty `Stack`, which
   * would still contribute a gap to the page above whatever follows it. The mapper already
   * dropped the blocks that would have rendered empty, so this is reachable in normal use.
   */
  if (visible.length === 0) return null

  return (
    <Stack space="xl">
      {visible.map((block) => (
        <Block baseLevel={resolved} block={block} childPages={childPages} key={block.id} />
      ))}
    </Stack>
  )
}
