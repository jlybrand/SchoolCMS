'use client'

import { useAuth, useDocumentInfo } from '@payloadcms/ui'
import Link from 'next/link'

import { isDistrictAdmin, isSchoolManager } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

/**
 * "Replace this file" on a file's own page (Jason, 2026-11-16) — it opens the replace form for
 * this file: a school's, and the district's too ("option 2"), so both get the prefilled
 * description and the not-checked note. Payload's own form still works for the district, under
 * the same rules. Nothing on a new file's screen.
 */
export const ReplaceFileLink = () => {
  const { id } = useDocumentInfo()
  const { user } = useAuth()
  if (id === undefined || id === null) return null
  const who = user as AuthUser | null
  if (!isSchoolManager(who) && !isDistrictAdmin(who)) return null
  return (
    <Link className="replace-file-link" href={`/admin/replace-file?file=${String(id)}`}>
      Replace this file
    </Link>
  )
}
