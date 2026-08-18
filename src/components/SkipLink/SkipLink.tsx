import type { ReactNode } from 'react'

import styles from './SkipLink.module.css'

/**
 * Bypass blocks — WCAG 2.4.1 (`07` §3).
 *
 * Every tenant page puts the same navigation ahead of its content, so keyboard and
 * screen-reader users need one move to skip it. Rendered as the first element in the body so
 * it is the first thing focus reaches.
 *
 * The id is exported rather than written as a literal in two files: a skip link pointing at
 * an element that has since been renamed still looks correct in review and silently does
 * nothing.
 */

/** The id on the `<main>` element of every public template. */
export const MAIN_CONTENT_ID = 'main-content'

export type SkipLinkProps = {
  readonly children: ReactNode
  /** Defaults to `MAIN_CONTENT_ID`. Override only where the first landmark differs. */
  readonly targetId?: string
}

export const SkipLink = ({ children, targetId = MAIN_CONTENT_ID }: SkipLinkProps) => (
  <a className={styles.skipLink} href={`#${targetId}`}>
    {children}
  </a>
)
