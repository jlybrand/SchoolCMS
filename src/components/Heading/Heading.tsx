import type { ReactNode } from 'react'

import styles from './Heading.module.css'
import { clampHeadingLevel } from './levels'
import type { HeadingLevel } from './levels'

/**
 * A heading whose element comes from the page outline and whose appearance does not.
 *
 * The two are separate props on purpose. Once levels are derived from position rather than
 * chosen, a block deep in an outline may own an `h4` that still needs to read as a section
 * title. Without `size`, the only way to make it look right would be to render a bigger
 * heading element — which is the violation the derivation prevents.
 */

export type HeadingSize = 'lg' | 'xl' | '2xl'

const SIZE_FOR_LEVEL: Record<HeadingLevel, HeadingSize> = {
  1: '2xl',
  2: 'xl',
  3: 'lg',
  4: 'lg',
  5: 'lg',
  6: 'lg',
}

export type HeadingProps = {
  readonly level: HeadingLevel
  readonly children: ReactNode
  /** Visual size only. Defaults to the size that matches `level`. */
  readonly size?: HeadingSize
  /** Set when a landmark names itself by reference to this heading (see `Section`). */
  readonly id?: string
}

export const Heading = ({ level, children, size, id }: HeadingProps) => {
  const resolved = clampHeadingLevel(level)
  const Tag = `h${resolved}` as const

  return (
    <Tag className={styles.heading} data-size={size ?? SIZE_FOR_LEVEL[resolved]} id={id}>
      {children}
    </Tag>
  )
}
