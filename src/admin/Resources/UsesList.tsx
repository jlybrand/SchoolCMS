import type { FileUses, UseVia } from '@/lib/file-uses'

import styles from './UsedOnField.module.css'

const VIA_LABEL: Record<UseVia, string> = {
  hero: 'Hero',
  image: 'Image',
  'document list': 'Document list',
}

/**
 * The published pages and announcements using a file, grouped (Jason, 2026-11-17) — the markup
 * the file's sidebar (`UsedOnField`) and the file library's details column (`FileDetails`) share.
 * Presentational only: it is handed the uses (`getFileUses`), so it renders on either side.
 * `headingLevel` keeps the outline right where it sits.
 */
export const UsesList = ({ uses, headingLevel = 3 }: { uses: FileUses; headingLevel?: 3 | 4 }) => {
  const Group = headingLevel === 3 ? 'h3' : 'h4'
  const empty = uses.pages.length + uses.announcements.length + uses.linked.length === 0
  return (
    <>
      {empty ? (
        <p className={styles.empty}>Not used on any published page or announcement.</p>
      ) : null}

      {uses.pages.length > 0 ? (
        <>
          <Group className={styles.group}>Pages</Group>
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
          <Group className={styles.group}>Shown on other sites</Group>
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
          <Group className={styles.group}>Announcements</Group>
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
    </>
  )
}
