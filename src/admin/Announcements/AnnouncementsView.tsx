import { Button, Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import type { ListViewServerProps } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { boardTree } from '@/admin/Boards/board-tree'
import { boardById } from '@/admin/SchoolPlane/school-data'
import { NewPostForm } from '@/admin/SchoolPlane/NewPostForm'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'

import {
  announcementStatus,
  boardFromQuery,
  boardHref,
  createPostHref,
  findBoard,
  soleBoard,
  wantsNewPost,
} from './announcements'
import styles from './Announcements.module.css'

/** Newest first, a page at a time — a board collects posts for years. */
const PER_PAGE = 25

const pageFromQuery = (query: unknown): number => {
  const page = (query as { page?: unknown } | undefined)?.page
  return typeof page === 'string' && /^[1-9]\d{0,4}$/.test(page) ? Number(page) : 1
}

const changed = new Intl.DateTimeFormat('en-US', {
  timeZone: DISTRICT_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * News and announcements (`/admin/collections/posts`), in place of Payload's flat list — Finalsite's
 * Posts module (Jason, 2026-11-04): the sites' folders, each opened to its boards; choose a board
 * and its posts are listed, newest first, with "Create post" at the top right.
 *
 * Everything is read AS THE VIEWER, so access decides what is listed: the district sees every
 * site; a school manager sees their own school's folders, boards and posts, and opens straight
 * onto their board if they have only one. "Create post" shows the headline here, above the posts;
 * entering it starts the post on that board and opens its form (`createPostHref` says why not
 * Payload's create form).
 *
 * Native `<details>`/`<summary>` for folders, as on the boards screen: a real disclosure, keyboard
 * operable and announced with no script. The chosen board is `aria-current`.
 */
export const AnnouncementsView = async ({ payload, user, searchParams }: ListViewServerProps) => {
  const viewer = user as AuthUser | null
  const district = isDistrictAdmin(viewer)
  const audience = sendsForApproval(viewer) ? 'school' : 'district'
  const asViewer = { user, overrideAccess: false, depth: 0, pagination: false } as const

  const [tenants, folders, boards] = await Promise.all([
    payload.find({ collection: 'tenants', ...asViewer, select: { name: true } }),
    payload.find({ collection: 'post-folders', ...asViewer }),
    payload.find({ collection: 'post-boards', ...asViewer }),
  ])
  const tree = boardTree(tenants.docs, folders.docs, boards.docs).filter(
    // A site the viewer has nothing on is noise to a school; the district sees every site.
    (site) => district || site.folders.length > 0,
  )

  const asked = boardFromQuery(searchParams)
  const selected = asked ?? soleBoard(tree)
  const found = findBoard(tree, selected)
  const page = pageFromQuery(searchParams)
  // "Create post": the headline, on this screen. The board is read again as the user, with its site.
  const newOn =
    found && selected && wantsNewPost(searchParams)
      ? await boardById(payload, user, selected)
      : null

  const posts =
    found && selected
      ? await payload.find({
          collection: 'posts',
          user,
          overrideAccess: false,
          draft: true,
          depth: 0,
          where: { board: { equals: selected } },
          sort: '-updatedAt',
          limit: PER_PAGE,
          page,
          select: { title: true, reviewState: true, updatedAt: true },
        })
      : null

  return (
    <Gutter>
      <div className={styles.view} id="announcements">
        <h1 className={styles.title}>News and announcements</h1>

        <div className={styles.layout}>
          <nav aria-label="Folders and boards" className={styles.tree}>
            {tree.length === 0 ? (
              <p className={styles.muted}>There are no announcement boards yet.</p>
            ) : (
              tree.map((site) => (
                <section aria-labelledby={`site-${site.id}`} className={styles.site} key={site.id}>
                  <h2 className={styles.siteName} id={`site-${site.id}`}>
                    {site.name}
                  </h2>
                  {site.folders.length === 0 ? (
                    <p className={styles.muted}>No folders yet.</p>
                  ) : (
                    site.folders.map((folder) => (
                      <details
                        className={styles.folder}
                        key={folder.id}
                        open={found?.folderId === folder.id}
                      >
                        <summary className={styles.summary}>{folder.name}</summary>
                        {folder.boards.length === 0 ? (
                          <p className={styles.muted}>No boards in this folder yet.</p>
                        ) : (
                          <ul className={styles.boards}>
                            {folder.boards.map((board) => (
                              <li key={board.id}>
                                <Link
                                  aria-current={board.id === selected ? 'page' : undefined}
                                  className={styles.boardLink}
                                  href={boardHref(board.id)}
                                >
                                  {board.name}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                    ))
                  )}
                </section>
              ))
            )}
            {district ? (
              <p className={styles.manage}>
                <Link href="/admin/collections/post-boards">Manage folders and boards</Link>
              </p>
            ) : null}
          </nav>

          <section aria-labelledby="board-heading" className={styles.board}>
            {found && selected && posts ? (
              <>
                <div className={styles.boardHeader}>
                  <div>
                    <p className={styles.where}>{found.site}</p>
                    <h2 className={styles.boardName} id="board-heading">
                      {found.folder} → {found.board}
                    </h2>
                  </div>
                  {newOn ? null : (
                    <Button
                      buttonStyle="primary"
                      el="link"
                      id="create-post"
                      margin={false}
                      to={createPostHref(selected)}
                    >
                      Create post
                    </Button>
                  )}
                </div>

                {newOn ? (
                  <section
                    aria-labelledby="new-post-heading"
                    className={styles.newPost}
                    id="new-post"
                  >
                    <h3 className={styles.newPostHeading} id="new-post-heading">
                      New announcement
                    </h3>
                    <NewPostForm boards={[newOn]} focusOnOpen />
                    <p className={styles.cancel}>
                      <Link href={boardHref(selected)}>Cancel</Link>
                    </p>
                  </section>
                ) : null}

                {posts.docs.length === 0 ? (
                  <p className={styles.muted}>No announcements on this board yet.</p>
                ) : (
                  <>
                    <table className={styles.posts}>
                      <thead>
                        <tr>
                          <th scope="col">Title</th>
                          <th scope="col">Status</th>
                          <th scope="col">Last changed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {posts.docs.map((post) => (
                          <tr key={post.id}>
                            <td>
                              <Link href={`/admin/collections/posts/${post.id}`}>
                                {post.title || 'Untitled announcement'}
                              </Link>
                            </td>
                            <td>{announcementStatus(post, audience)}</td>
                            <td>
                              {post.updatedAt ? changed.format(new Date(post.updatedAt)) : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {posts.totalPages > 1 ? (
                      <p className={styles.pages}>
                        {posts.hasPrevPage ? (
                          <Link href={`${boardHref(selected)}&page=${page - 1}`}>Newer</Link>
                        ) : null}
                        <span>
                          Page {posts.page} of {posts.totalPages}
                        </span>
                        {posts.hasNextPage ? (
                          <Link href={`${boardHref(selected)}&page=${page + 1}`}>Older</Link>
                        ) : null}
                      </p>
                    ) : null}
                  </>
                )}
              </>
            ) : (
              <>
                <h2 className={styles.boardName} id="board-heading">
                  {asked ? 'That board can’t be opened' : 'Choose a board'}
                </h2>
                <p className={styles.muted}>
                  {asked
                    ? 'It may have been removed, or it belongs to another school. Choose one of the boards listed.'
                    : 'Open a folder and choose a board to see its announcements and create a post.'}
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </Gutter>
  )
}
