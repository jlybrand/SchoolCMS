import type { ReactNode } from 'react'

import styles from './Stack.module.css'

/**
 * Vertical rhythm, from `gap` rather than from margins.
 *
 * `gap` on a flex column means spacing never depends on which sibling collapsed its margin
 * into which — and, more to the point, visual order always equals DOM order (1.3.2 meaningful
 * sequence). A layout that reorders visually is a layout a screen reader reads in a different
 * order than it looks.
 */

export type StackSpace = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export type StackProps = {
  readonly children: ReactNode
  readonly space?: StackSpace
}

export const Stack = ({ children, space = 'md' }: StackProps) => (
  <div className={styles.stack} data-space={space}>
    {children}
  </div>
)
