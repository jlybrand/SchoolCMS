import { RichText } from '@/components/RichText'
import type { HeadingLevel } from '@/components/Heading'
import type { RichTextPageBlock } from '@/content/types'

/**
 * Prose within a composed page (`03` §3.1).
 *
 * A thin wrapper over `RichText`, and deliberately thin: prose renders identically whether
 * it arrived as a fixed-type page's `body` or as a block on a composed one. Two renderers
 * for the same nodes would be two places for the heading contract to drift.
 *
 * It has NO CSS module. Paragraph and list spacing live on the elements themselves in
 * `src/styles/globals.css`, and the gap between blocks belongs to whoever stacks them —
 * `BlockList`, via `Stack`. A module here would fight both.
 */

export type RichTextBlockProps = {
  readonly block: RichTextPageBlock
  /** From the page outline. The author's "top-level heading" becomes this element. */
  readonly baseLevel: HeadingLevel
}

export const RichTextBlock = ({ block, baseLevel }: RichTextBlockProps) => (
  <RichText baseLevel={baseLevel} content={block.content} />
)
