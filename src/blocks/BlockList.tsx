import { BLOCK_HEADING_LEVEL, clampHeadingLevel } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import { Stack } from '@/components/Stack'
import type { PageBlock } from '@/content/types'

import { Accordion } from './Accordion'
import { CallToAction } from './CallToAction'
import { CardGrid } from './CardGrid'
import { Divider } from './Divider'
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
  readonly blocks: readonly PageBlock[]
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
}: {
  readonly block: PageBlock
  readonly baseLevel: HeadingLevel
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
    case 'divider':
      // No heading, so no level to thread — see `Divider`.
      return <Divider />
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

export const BlockList = ({ blocks, baseLevel = BLOCK_HEADING_LEVEL }: BlockListProps) => {
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
   * A composed page with no blocks renders nothing rather than an empty `Stack`, which would
   * still contribute a gap to the page above whatever follows it. The mapper already dropped
   * the blocks that would have rendered empty, so this is reachable in normal use.
   */
  if (blocks.length === 0) return null

  return (
    <Stack space="xl">
      {blocks.map((block) => (
        <Block baseLevel={resolved} block={block} key={block.id} />
      ))}
    </Stack>
  )
}
