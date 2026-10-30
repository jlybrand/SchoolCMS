import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import type { AuthUser } from '@/access/types'

import { BOARDS_PATH, newPostRoute } from './new-post-route'
import { NewPostForm } from './NewPostForm'
import { boardById, listMyBoards } from './school-data'
import styles from './SchoolPlane.module.css'

/**
 * "Post an announcement" (`04` §2.2) — the headline and the board, then the announcement's own
 * form. The school follows from the board.
 *
 * Creating it from the headline first is what lets autosave cover the words from the first
 * keystroke, as "Add a page" does (`docs/phases/04` §5). The words are required when it is sent
 * (`postNeedsWords`), not here.
 *
 * Board-first for the district too (Jason, 2026-10-29): it arrives from the boards screen with
 * `?board=<id>`, sees that board named, and gives only the headline — the site follows from the
 * board, so Payload's site question never comes up. Who gets which is `newPostRoute`.
 */
export const NewPostView = async ({ initPageResult, searchParams }: AdminViewServerProps) => {
  const { req } = initPageResult
  const route = newPostRoute(req.user as AuthUser | null, searchParams?.board)
  if ('redirect' in route) redirect(route.redirect)

  if (route.as === 'district') {
    const board = await boardById(req, route.board)
    if (!board) redirect(BOARDS_PATH)
    return (
      <Gutter>
        <div className={styles.view} id="new-post">
          <p className={styles.back}>
            <Link href={BOARDS_PATH}>Back to announcement boards</Link>
          </p>
          <h1 className={styles.title}>Post an announcement</h1>
          <p className={styles.hint} id="new-post-board">
            On the board <strong>{board.label}</strong>.
          </p>
          <NewPostForm boards={[board]} />
        </div>
      </Gutter>
    )
  }

  const boards = await listMyBoards(req)

  return (
    <Gutter>
      <div className={styles.view} id="new-post">
        <p className={styles.back}>
          <Link href="/admin">Back to start</Link>
        </p>
        <h1 className={styles.title}>Post an announcement</h1>
        <NewPostForm boards={boards} />
      </div>
    </Gutter>
  )
}
