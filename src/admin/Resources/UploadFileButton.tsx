'use client'

import { Button, useAuth } from '@payloadcms/ui'

import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

/**
 * "Upload a file" on the file library's list (Jason, 2026-11-13: files are uploaded, not
 * "created"). Takes the place of Payload's "Create New", which `admin-overrides.css` hides on
 * this list only — its wording is Payload's for every collection. A school manager goes to the
 * school plane's own upload (`/admin/upload-file`): Payload's screen refuses them.
 */
export const UploadFileButton = () => {
  const { user } = useAuth()
  const school = sendsForApproval(user as AuthUser | null)
  return (
    <div className="upload-file-action">
      <Button
        buttonStyle="primary"
        el="link"
        id="list-upload-file"
        margin={false}
        to={school ? '/admin/upload-file' : '/admin/collections/resources/create'}
      >
        Upload a file
      </Button>
    </div>
  )
}
