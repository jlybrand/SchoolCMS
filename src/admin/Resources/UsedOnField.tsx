import type { UIFieldServerProps } from 'payload'

import { getFileUses } from './file-uses-data'
import styles from './UsedOnField.module.css'
import type { UseVia } from '@/lib/file-uses'

const VIA_LABEL: Record<UseVia, string> = {
  hero: 'Hero',
  image: 'Image',
  'document list': 'Document list',
}

/**
 * "Where it's used" in a file's sidebar (Jason, 2026-11-17), on both planes: the PUBLISHED pages
 * and announcements showing this file, so an editor sees what a replace or a delete affects.
 * Worked out each time the file's page opens (`getFileUses`, read as the user; the rule is
 * `src/lib/file-uses.ts`). Nothing on a new file's screen.
 *
 * Styled from Payload's theme variables, as `ReviewStatusField` is: DD2 tokens aren't loaded in
 * the admin and don't follow its dark theme.
 */
export const UsedOnField = async ({ id, req }: UIFieldServerProps) => {
  if (id === undefined || id === null) return null
  const uses = await getFileUses(req, id)
  if (uses === null) return null
  const empty = uses.pages.length + uses.announcements.length + uses.linked.length === 0

  return (
    <section
      aria-labelledby="used-on-heading"
      className={`field-type ${styles.usedOn}`}
      id="used-on"
    >
      <h2 className={styles.heading} id="used-on-heading">
        Where it’s used
      </h2>
      {empty ? (
        <p className={styles.empty}>Not used on any published page or announcement.</p>
      ) : null}

      {uses.pages.length > 0 ? (
        <>
          <h3 className={styles.group}>Pages</h3>
          <ul className={styles.list}>
            {uses.pages.map((page) => (
              <li key={String(page.id)}>
                <a href={`/admin/collections/pages/${String(page.id)}`}>{page.title}</a>
                <span className={styles.detail}>
                  {[
                    page.path,
                    page.via.map((v) => VIA_LABEL[v]).join(', '),
                    page.staffOnly ? 'Staff only' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {uses.linked.length > 0 ? (
        <>
          <h3 className={styles.group}>Shown on other sites</h3>
          <ul className={styles.list}>
            {uses.linked.map((page) => (
              <li key={String(page.id)}>
                <a href={`/admin/collections/pages/${String(page.id)}`}>{page.title}</a>
                <span className={styles.detail}>{page.site}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {uses.announcements.length > 0 ? (
        <>
          <h3 className={styles.group}>Announcements</h3>
          <ul className={styles.list}>
            {uses.announcements.map((post) => (
              <li key={String(post.id)}>
                <a href={`/admin/collections/posts/${String(post.id)}`}>{post.title}</a>
                {post.alsoOn.length > 0 ? (
                  <span className={styles.detail}>Also on {post.alsoOn.join(', ')}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className={styles.note}>A link to this file typed into a page’s text isn’t counted.</p>
    </section>
  )
}
