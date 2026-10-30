import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ListViewServerProps } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

import { boardTree } from './board-tree'
import styles from './Boards.module.css'

/**
 * The district's announcement boards (Jason, 2026-10-28), in place of Payload's flat list at
 * `/admin/collections/post-boards`: each site, its folders — each opened to show and pick its
 * boards — because boards belong to folders.
 *
 * Native `<details>`/`<summary>`: a real disclosure, operable by keyboard and announced as
 * expanded or collapsed with no script. Read AS THE VIEWER, so access decides what is listed;
 * site names are routing data, read as the platform. District only — a school manager is sent
 * home, as from the approval queue; they pick a board when posting and never manage them.
 */
export const BoardsListView = async ({ payload, user, newDocumentURL }: ListViewServerProps) => {
  if (!isDistrictAdmin(user as AuthUser | null)) redirect('/admin')

  const [tenants, folders, boards] = await Promise.all([
    payload.find({
      collection: 'tenants',
      pagination: false,
      depth: 0,
      overrideAccess: true,
      select: { name: true },
    }),
    payload.find({
      collection: 'post-folders',
      pagination: false,
      depth: 0,
      user,
      overrideAccess: false,
    }),
    payload.find({
      collection: 'post-boards',
      pagination: false,
      depth: 0,
      user,
      overrideAccess: false,
    }),
  ])
  const tree = boardTree(tenants.docs, folders.docs, boards.docs)

  return (
    <Gutter>
      <div className={styles.view} id="boards">
        <h1 className={styles.title}>Announcement boards</h1>
        <p className={styles.muted}>
          Each site’s folders. Open a folder to see its boards: choose a board to change it, or post
          a new announcement on it.
        </p>
        <p className={styles.actions}>
          <Link href="/admin/collections/post-folders/create">Add a folder</Link>
          <Link href={newDocumentURL}>Add a board</Link>
        </p>

        {tree.map((site) => (
          <section aria-labelledby={`site-${site.id}`} className={styles.site} key={site.id}>
            <h2 className={styles.siteName} id={`site-${site.id}`}>
              {site.name}
            </h2>
            {site.folders.length === 0 ? (
              <p className={styles.muted}>No folders yet.</p>
            ) : (
              site.folders.map((folder) => (
                <details className={styles.folder} key={folder.id}>
                  <summary className={styles.summary}>
                    {folder.name}{' '}
                    <span className={styles.count}>
                      ({folder.boards.length} {folder.boards.length === 1 ? 'board' : 'boards'})
                    </span>
                  </summary>
                  {folder.boards.length === 0 ? (
                    <p className={styles.muted}>No boards in this folder yet.</p>
                  ) : (
                    <ul className={styles.boards}>
                      {folder.boards.map((board) => (
                        <li className={styles.board} key={board.id}>
                          <Link href={`/admin/collections/post-boards/${board.id}`}>
                            {board.name}
                          </Link>
                          {/* Board-first, as in Finalsite (Jason, 2026-10-29). Named in full for
                              a screen reader: every site has a "News". */}
                          <Link href={`/admin/new-post?board=${encodeURIComponent(board.id)}`}>
                            New announcement
                            <span className={styles.visuallyHidden}>
                              {' '}
                              on {site.name} · {folder.name} → {board.name}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {folder.id === 'unfiled' ? null : (
                    <p className={styles.folderActions}>
                      <Link href={`/admin/collections/post-folders/${folder.id}`}>
                        Rename or remove the folder “{folder.name}”
                      </Link>
                    </p>
                  )}
                </details>
              ))
            )}
          </section>
        ))}
      </div>
    </Gutter>
  )
}
