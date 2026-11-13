'use client'

import { Button } from '@payloadcms/ui'

/**
 * "Upload a file" on the file library's list (Jason, 2026-11-13: files are uploaded, not
 * "created"). Takes the place of Payload's "Create New", which `admin-overrides.css` hides on
 * this list only — its wording is Payload's for every collection.
 */
export const UploadFileButton = () => (
  <div className="upload-file-action">
    <Button
      buttonStyle="primary"
      el="link"
      id="upload-file"
      margin={false}
      to="/admin/collections/resources/create"
    >
      Upload a file
    </Button>
  </div>
)
