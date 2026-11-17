import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'
import { fileSizeLabel, fileTypeLabel } from '@/content/document-item'

import { getFileUses } from '@/admin/Resources/file-uses-data'
import { usesSummary } from '@/lib/file-uses'

import { getMyFile, listMyFiles } from './school-data'
import styles from './SchoolPlane.module.css'
import { ReplaceFileForm } from './ReplaceFileForm'

/**
 * "Replace a file" (Jason, 2026-11-16) — a new version of a file in the old one's place, the same
 * kind only, keeping its library entry so every page using it shows the new one. No approval, as
 * with uploads.
 *
 * Two steps, as "Update a page" has: which file (the school's files by title), then its form
 * (`?file=<id>`). Read as the user, so a school sees its own files only; another school's id
 * reads as not found.
 *
 * The district uses the form too (Jason, 2026-11-16, "option 2"), reaching it from a file's own
 * page ("Replace this file"), so it gets the same prefilled description and not-checked note. The
 * first step stays the school's: a list of every school's files is no use to the district, which
 * finds a file in the Files list. So the district, without `?file`, goes there; and its way back
 * is to the file's page.
 */
export const ReplaceFileView = async ({ initPageResult, searchParams }: AdminViewServerProps) => {
  const { req } = initPageResult
  const user = req.user as AuthUser | null
  const school = sendsForApproval(user)
  const district = !school && isDistrictAdmin(user)

  const requested = searchParams?.file
  const fileId = typeof requested === 'string' ? requested : null

  if (!school && (!district || fileId === null)) redirect('/admin/collections/resources')

  if (fileId !== null) {
    const file = await getMyFile(req, fileId)
    const uses = file === null ? null : await getFileUses(req, file.id)
    return (
      <Gutter>
        <div className={styles.view} id="replace-file">
          <p className={styles.back}>
            {district ? (
              file === null ? (
                <Link href="/admin/collections/resources">Back to the files</Link>
              ) : (
                <Link href={`/admin/collections/resources/${String(file.id)}`}>
                  Back to the file
                </Link>
              )
            ) : (
              <Link href="/admin/replace-file">Choose another file</Link>
            )}
          </p>
          {file === null ? (
            <>
              <h1 className={styles.title}>Replace a file</h1>
              <p className={styles.empty}>
                {district
                  ? 'That file isn’t in the library.'
                  : 'That file isn’t in your school’s library.'}
              </p>
            </>
          ) : (
            <>
              <h1 className={styles.title}>Replace “{file.title}”</h1>
              <ReplaceFileForm file={file} usedOn={uses === null ? null : usesSummary(uses)} />
            </>
          )}
        </div>
      </Gutter>
    )
  }

  const files = await listMyFiles(req)
  return (
    <Gutter>
      <div className={styles.view} id="replace-file">
        <p className={styles.back}>
          <Link href="/admin">Back to start</Link>
        </p>
        <h1 className={styles.title}>Which file do you want to replace?</h1>
        <p className={styles.intro}>
          The new file takes the old one’s place everywhere it is used — an image for an image, a
          document for a document.
        </p>
        {files.length === 0 ? (
          <p className={styles.empty}>Your school’s library has no files yet.</p>
        ) : (
          <ul className={styles.rows}>
            {files.map((file) => {
              const size = fileSizeLabel(file.filesize)
              return (
                <li className={styles.row} key={String(file.id)}>
                  <span className={styles.named}>
                    <Link href={`/admin/replace-file?file=${String(file.id)}`}>{file.title}</Link>
                  </span>
                  <span className={styles.state}>
                    {[
                      file.kind === 'image' ? 'Image' : fileTypeLabel(file.mimeType),
                      size,
                      file.folder,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Gutter>
  )
}
