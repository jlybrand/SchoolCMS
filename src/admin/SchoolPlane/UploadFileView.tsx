import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

import { listMyFolders, listMySchools } from './school-data'
import styles from './SchoolPlane.module.css'
import { UploadFileForm } from './UploadFileForm'

/**
 * "Upload a file" (Jason, 2026-11-13) — a school's upload to its own library. Payload's own upload
 * screen refuses a school manager (its access check runs before a school is known), so the school
 * plane has this one. No approval: a file isn't on the site until an approved page uses it.
 *
 * School plane only; the district uploads through Payload's screen.
 */
export const UploadFileView = async ({ initPageResult }: AdminViewServerProps) => {
  const { req } = initPageResult
  if (!sendsForApproval(req.user as AuthUser | null))
    redirect('/admin/collections/resources/create')

  const [schools, folders] = await Promise.all([listMySchools(req), listMyFolders(req)])

  return (
    <Gutter>
      <div className={styles.view} id="upload-file">
        <p className={styles.back}>
          <Link href="/admin">Back to start</Link>
        </p>
        <h1 className={styles.title}>Upload a file</h1>
        <p className={styles.intro}>
          An image or a document for your school’s website. Video goes on YouTube.
        </p>
        <UploadFileForm folders={folders} schools={schools} />
      </div>
    </Gutter>
  )
}
