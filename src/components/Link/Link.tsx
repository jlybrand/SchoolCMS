import type { ReactNode } from 'react'

import { VisuallyHidden } from '../VisuallyHidden'

import styles from './Link.module.css'

/**
 * A link.
 *
 * Three things it owns so no block author has to remember them:
 *
 *   - **Underlined, always.** Distinguishing a link from body text by colour alone fails
 *     1.4.1; it also disappears entirely for anyone using a high-contrast or custom stylesheet.
 *   - **A new window is announced.** 3.2.5 is AAA, but an unannounced new tab is a real
 *     orientation problem for screen-reader and magnifier users, and the notice is free when
 *     the component adds it.
 *   - **`rel` follows `target`.** `target="_blank"` without `rel="noopener"` hands the opened
 *     page a handle on this one.
 *
 * A plain anchor, not a client-side router link. This is a cache-first static site, so client
 * navigation would buy nothing and cost the route-change announcement problem: a soft
 * navigation moves no focus and speaks no new page title unless the app reimplements both.
 */

const ABSOLUTE_HTTP = /^https?:\/\//i

export type LinkProps = {
  readonly href: string
  readonly children: ReactNode
  /**
   * Opens in a new window and says so. Reserve it for destinations that genuinely must not
   * replace the page — a form the visitor is part-way through, a document viewer.
   */
  readonly newWindow?: boolean
  /**
   * The new-window notice. A prop because it is visitor-facing text: Phase 7 translates it
   * through the render-layer pipeline rather than leaving one English string in the markup
   * of every locale (`08` §4).
   */
  readonly newWindowLabel?: string
  /**
   * WCAG 3.1.2 Language of Parts — set when the link text is in a different language from
   * the page around it. The language switcher is the standing case: it names each language
   * in its own script (`08` §6), so every one of its links needs this.
   */
  readonly lang?: string
  /** The language of the destination document. A UA and search-engine hint (`08` §5). */
  readonly hrefLang?: string
}

export const Link = ({
  href,
  children,
  newWindow = false,
  newWindowLabel = 'opens in a new window',
  lang,
  hrefLang,
}: LinkProps) => (
  <a
    className={styles.link}
    href={href}
    lang={lang}
    hrefLang={hrefLang}
    {...(ABSOLUTE_HTTP.test(href) ? { 'data-external': 'true' } : {})}
    {...(newWindow ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
  >
    {children}
    {newWindow ? <VisuallyHidden> ({newWindowLabel})</VisuallyHidden> : null}
  </a>
)
