'use client'

import { useAuth, useDocumentInfo } from '@payloadcms/ui'
import Link from 'next/link'

import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

/**
 * "Replace this file" on a file's own page, for a school (Jason, 2026-11-16) — it opens the school
 * plane's replace form for this file. The district replaces a file here, through Payload's own
 * form, where the same rules hold (the same kind only; a document marked not checked). Nothing on
 * a new file's screen.
 */
export const ReplaceFileLink = () => {
  const { id } = useDocumentInfo()
  const { user } = useAuth()
  if (id === undefined || id === null) return null
  if (!sendsForApproval(user as AuthUser | null)) return null
  return (
    <Link className="replace-file-link" href={`/admin/replace-file?file=${String(id)}`}>
      Replace this file
    </Link>
  )
}
