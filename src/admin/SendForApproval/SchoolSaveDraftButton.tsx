'use client'

import { SaveDraftButton, useAuth } from '@payloadcms/ui'

import type { AuthUser } from '@/access/types'

import { sendsForApproval } from './review-status'

/**
 * Fills Payload's `SaveDraftButton` slot on `pages`.
 *
 * Payload shows Save draft only on a page that has never been saved (autosave covers the rest
 * — see `drafts.validate` in `src/collections/Pages.ts`). For a school manager that is a
 * second button beside "Send for approval", which `04` §2.3 rules out: one button, and the
 * word "draft" is not theirs. So a school manager's new page is created by sending it.
 *
 * The district keeps Save draft. The school plane's own "new page" form, which asks for a
 * title before anything else, is where an unsent new page will come from.
 */
export const SchoolSaveDraftButton = () => {
  const { user } = useAuth()
  if (sendsForApproval(user as AuthUser | null)) return null
  return <SaveDraftButton />
}
