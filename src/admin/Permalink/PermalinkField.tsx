'use client'

import { useDocumentInfo } from '@payloadcms/ui'

import { permalinkPath } from '@/lib/permalink'

import styles from './PermalinkField.module.css'

/**
 * The page's permanent link, in the sidebar (Jason, 2026-10-29) — the address to give out when
 * a link must keep working after the page is renamed or moved, as Finalsite's `/fs/pages/<id>`.
 *
 * Plain selectable text, not a copy button: a button that silently writes the clipboard says
 * nothing to a screen reader unless it also announces, and selecting text already works
 * everywhere. Nothing shows until the page has been saved once, because until then it has no id.
 *
 * Styled from Payload's theme variables, as `ReviewStatusField` is.
 */
export const PermalinkField = () => {
  const { id } = useDocumentInfo()
  if (id === undefined || id === null || id === '') return null

  return (
    <div className={styles.permalink}>
      <p className={styles.label}>Permanent link</p>
      <p className={styles.path}>
        <code>{permalinkPath(id)}</code>
      </p>
      <p className={styles.hint}>
        Add this to the end of the site’s address. It keeps working if the page is renamed or moved.
      </p>
    </div>
  )
}
