import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

import { LinkedIcon } from '@/admin/LinkedPage/LinkedIcon'

import { listSchoolPages } from './school-data'
import { submissionStatus } from './school-plane'
import styles from './SchoolPlane.module.css'

/**
 * "Update a page" (`04` §2.2) — the school's pages by title, each opening its form.
 *
 * In place of Payload's list view, which is a table of a collection: columns, filters, bulk
 * selection, the word "Pages" over a data grid. A school manager needs only "which page", so
 * this is a list of names. The list view stays reachable; it is not the path offered.
 *
 * School plane only. Anyone else is sent to the home screen, which is theirs.
 */
export const UpdatePageView = async ({ initPageResult }: AdminViewServerProps) => {
  const { req } = initPageResult
  if (!sendsForApproval(req.user as AuthUser | null)) redirect('/admin')

  const pages = await listSchoolPages(req)

  return (
    <Gutter>
      <div className={styles.view} id="update-page">
        <p className={styles.back}>
          <Link href="/admin">Back to start</Link>
        </p>
        <h1 className={styles.title}>Which page do you want to update?</h1>
        {pages.length === 0 ? (
          <p className={styles.empty}>Your school has no pages yet.</p>
        ) : (
          <ul className={styles.rows}>
            {pages.map((page) => {
              const status = submissionStatus(page.reviewState)
              return (
                <li className={styles.row} key={page.id}>
                  <Link href={`/admin/collections/pages/${page.id}`}>{page.title}</Link>
                  {/* A linked page opens another page; editing its words changes nothing seen. */}
                  {page.linked ? (
                    <span className={styles.state}>
                      <LinkedIcon className={styles.linkedIcon} />
                      Linked
                    </span>
                  ) : null}
                  {status ? <span className={styles.state}>{status}</span> : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Gutter>
  )
}
