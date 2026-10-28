import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

import { NewPostForm } from './NewPostForm'
import { listMyBoards } from './school-data'
import styles from './SchoolPlane.module.css'

/**
 * "Post an announcement" (`04` §2.2) — the headline and the board, then the announcement's own
 * form. The school follows from the board.
 *
 * Creating it from the headline first is what lets autosave cover the words from the first
 * keystroke, as "Add a page" does (`docs/phases/04` §5). The words are required when it is sent
 * (`postNeedsWords`), not here.
 *
 * School plane only; the district posts through Payload's own form.
 */
export const NewPostView = async ({ initPageResult }: AdminViewServerProps) => {
  const { req } = initPageResult
  if (!sendsForApproval(req.user as AuthUser | null)) redirect('/admin')

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
