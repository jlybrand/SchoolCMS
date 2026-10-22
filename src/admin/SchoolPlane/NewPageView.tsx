import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

import { NewPageForm } from './NewPageForm'
import { listMySchools } from './school-data'
import styles from './SchoolPlane.module.css'

/**
 * "Add a page" (`04` §2.4) — the constrained create.
 *
 * Asks only what a new page cannot exist without: a title and what kind of page it is. The
 * address is made from the title, the school from the user's assignment, and the page enters
 * no menu until the district places it. Creating it up front is what lets autosave cover it
 * from the first keystroke on the next screen (`docs/phases/04` §5).
 *
 * School plane only; the district creates pages through Payload's own form.
 */
export const NewPageView = async ({ initPageResult }: AdminViewServerProps) => {
  const { req } = initPageResult
  if (!sendsForApproval(req.user as AuthUser | null)) redirect('/admin')

  const schools = await listMySchools(req)

  return (
    <Gutter>
      <div className={styles.view} id="new-page">
        <p className={styles.back}>
          <Link href="/admin">Back to start</Link>
        </p>
        <h1 className={styles.title}>Add a page</h1>
        <NewPageForm schools={schools} />
      </div>
    </Gutter>
  )
}
