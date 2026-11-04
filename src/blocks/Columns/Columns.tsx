import type { ReactNode } from 'react'

import { Heading } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import type { ResolvedColumnsBlock, ResolvedPageBlock } from '@/content/types'

import { columnLevels } from './levels'
import styles from './Columns.module.css'

/**
 * Two or three columns, each holding other blocks (Jason, 2026-11-04). Side by side where there
 * is room; stacked, contents and all, where there is not — the order on a phone is the reading
 * order, first column first.
 *
 * NESTING WITHOUT A HAND-CHECKED OUTLINE. Every heading inside sits one step below the nearest
 * heading above it (`columnLevels`): the set's own, then the column's. So whatever the district
 * places in a column, the page cannot skip a heading level.
 *
 * IT DOES NOT RENDER ITS OWN CONTENTS. `renderBlocks` is `BlockList`, handed in: the list renders
 * columns and columns render lists, and taking it as a prop keeps the two files from importing
 * each other.
 */

export type ColumnsProps = {
  readonly block: ResolvedColumnsBlock
  readonly baseLevel: HeadingLevel
  readonly renderBlocks: (
    blocks: readonly ResolvedPageBlock[],
    baseLevel: HeadingLevel,
  ) => ReactNode
}

export const Columns = ({ block, baseLevel, renderBlocks }: ColumnsProps) => (
  <div>
    {block.heading === null ? null : <Heading level={baseLevel}>{block.heading}</Heading>}

    <div className={styles.columns} data-count={block.columns.length}>
      {block.columns.map((column, index) => {
        const levels = columnLevels(baseLevel, {
          blockHeading: block.heading !== null,
          columnHeading: column.heading !== null,
        })
        return (
          <div className={styles.column} key={index}>
            {column.heading === null ? null : (
              <Heading level={levels.column} size="lg">
                {column.heading}
              </Heading>
            )}
            {renderBlocks(column.blocks, levels.content)}
          </div>
        )
      })}
    </div>
  </div>
)
