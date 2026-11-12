import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import type { DocumentViewServerProps } from 'payload'

import { loadPublishHistory } from './history-data'
import styles from './History.module.css'

/**
 * A page's or announcement's History (Jason, 2026-11-12): its publishes over the last year,
 * newest first — how it went live, who, when, and what they wrote, with the school's note for an
 * approval — each opening the version it made, where Payload's own version screen offers Restore
 * (published versions only, the district's only: `src/collections/hooks/page-history.ts`).
 *
 * In place of Payload's list of every version, autosaves included, which buried the publishes.
 * Every version is still kept (`maxPerDoc: 0`), so the links keep working.
 */
export const HistoryView = async ({ doc, initPageResult }: DocumentViewServerProps) => {
  const collection = initPageResult.collectionConfig?.slug
  const id = (doc as { id?: number | string } | undefined)?.id
  if ((collection !== 'pages' && collection !== 'posts') || id === undefined) return null
  const noun = collection === 'posts' ? 'announcement' : 'page'
  const rows = await loadPublishHistory(initPageResult.req, collection, id)

  return (
    <Gutter>
      <div className={styles.view} id="publish-history">
        <h2 className={styles.title}>History</h2>
        {rows === null ? (
          <p className={styles.lead}>The history of this {noun} is kept for the district.</p>
        ) : rows.length === 0 ? (
          <p className={styles.lead}>Nothing has been published in the last year.</p>
        ) : (
          <>
            <p className={styles.lead}>
              Each time this {noun} was published in the last year, newest first. Open one to see it
              as it was, and to restore it.
            </p>
            <ol className={styles.list}>
              {rows.map((row) => (
                <li className={styles.row} key={row.id}>
                  <p className={styles.head}>
                    <span className={styles.label}>{row.label}</span>
                    <span className={styles.meta}>
                      {row.when} · {row.who}
                    </span>
                  </p>
                  {row.schoolNote ? (
                    <div className={styles.note}>
                      <p className={styles.noteLabel}>The school’s note</p>
                      <blockquote className={styles.quote}>{row.schoolNote}</blockquote>
                    </div>
                  ) : null}
                  {row.comment ? (
                    <div className={styles.note}>
                      <p className={styles.noteLabel}>Comment</p>
                      <blockquote className={styles.quote}>{row.comment}</blockquote>
                    </div>
                  ) : null}
                  {row.href ? (
                    <Link className={styles.open} href={row.href}>
                      Open this version
                      <span className={styles.visuallyHidden}> from {row.when}</span>
                    </Link>
                  ) : (
                    <p className={styles.muted}>This version can no longer be opened.</p>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </Gutter>
  )
}
