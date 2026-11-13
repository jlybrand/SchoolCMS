'use client'

import { useDocumentInfo } from '@payloadcms/ui'

/**
 * "Uploading a file" on a new file's screen (Jason, 2026-11-13), in place of Payload's
 * "Creating new File" — hidden for this collection only in `admin-overrides.css`. Nothing once
 * the file is saved: Payload's own details take over.
 */
export const UploadingHeading = () => {
  const { id } = useDocumentInfo()
  if (id !== undefined && id !== null) return null
  return <p className="uploading-heading">Uploading a file</p>
}
