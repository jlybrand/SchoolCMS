import type { ReactNode } from 'react'

import styles from './Container.module.css'

/**
 * Horizontal measure and gutters — the single owner of both (`07` §7).
 *
 * `prose` caps line length at the reading measure, which is a legibility requirement, not a
 * taste one; `wide` is for block layouts that hold more than one column. Both use logical
 * properties, so the gutters mirror in Arabic without a second rule (`08` §7).
 *
 * No `role`, no `as`, no `className` prop: a wrapper that could emit semantics would show up
 * in the landmark list of every page competing with the landmarks that mean something, and a
 * `className` escape hatch is how the logical-properties guardrail gets bypassed one
 * component at a time.
 */

export type ContainerWidth = 'prose' | 'wide'

export type ContainerProps = {
  readonly children: ReactNode
  readonly width?: ContainerWidth
}

export const Container = ({ children, width = 'prose' }: ContainerProps) => (
  <div className={styles.container} data-width={width}>
    {children}
  </div>
)
