import { clampHeadingLevel, type HeadingLevel } from '@/components/Heading/levels'

export type ColumnLevels = { block: HeadingLevel; column: HeadingLevel; content: HeadingLevel }

/**
 * Heading levels inside Columns (Jason, 2026-11-04: blocks may nest). Each heading sits one step
 * below the nearest heading above it — the block's own, then the column's — so the blocks inside a
 * column start below whichever is there. Placing blocks in columns therefore cannot skip a level,
 * and nobody has to check the outline by hand. Clamped at h6.
 */
export const columnLevels = (
  base: HeadingLevel,
  { blockHeading, columnHeading }: { blockHeading: boolean; columnHeading: boolean },
): ColumnLevels => {
  const column = clampHeadingLevel(blockHeading ? base + 1 : base)
  const content = clampHeadingLevel(columnHeading ? column + 1 : column)
  return { block: base, column, content }
}
