import type { ReactNode } from 'react'

import styles from './VisuallyHidden.module.css'

/**
 * Text for assistive technology only — present in the accessible tree, absent from the
 * visual design.
 *
 * Not `display: none`, not `aria-hidden`, not zero size: all three remove the content from
 * the accessible tree, which is the opposite of the intent. The clip technique below is the
 * one that keeps it announced.
 */

export type VisuallyHiddenProps = {
  readonly children: ReactNode
}

export const VisuallyHidden = ({ children }: VisuallyHiddenProps) => (
  <span className={styles.visuallyHidden} data-visually-hidden="true">
    {children}
  </span>
)
