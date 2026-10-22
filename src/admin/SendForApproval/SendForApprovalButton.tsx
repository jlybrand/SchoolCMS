'use client'

import {
  FormSubmit,
  PublishButton,
  useAuth,
  useConfig,
  useDocumentInfo,
  useForm,
  useLocale,
} from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { useCallback } from 'react'

import type { AuthUser } from '@/access/types'

import { sendsForApproval } from './review-status'
import './send-for-approval.css'

/** `04` §2.3 fixes this wording. Not "Save", not "Publish", not "Save draft". */
export const SEND_FOR_APPROVAL = 'Send for approval'

/**
 * Fills Payload's `PublishButton` slot on `pages` (`04` §2.3).
 *
 * A district admin gets Payload's own Publish button, untouched. A school manager gets the one
 * button — and would otherwise get NOTHING: Payload's PublishButton renders null without
 * publish permission, and with autosave on there is no Save draft button either, so before
 * this the school form had no submit control at all.
 *
 * WHAT IT SENDS. A draft save with `reviewState: 'submitted'` — the same request Payload's
 * Save draft makes, plus the one field. `applyReviewState` decides what that write means
 * (`src/access/review-state.ts`); this control asks, it does not decide. A crafted request
 * gains nothing over the button: it is the same write, through the same gate.
 *
 * VALIDATED, unlike Save draft (which skips client validation): sending a page without a
 * title for approval is a mistake to show now, not one for the district to find in the queue.
 *
 * NEVER DISABLED. After an autosave the form is unmodified, and sending an unmodified page is
 * exactly the point — the changes are already saved, this moves them to the queue. Pressing
 * it on a page already waiting keeps it waiting (`04` §4.1), so a second press is harmless.
 */
export const SendForApprovalButton = () => {
  const { user } = useAuth()
  if (!sendsForApproval(user as AuthUser | null)) return <PublishButton />
  return <SendButton />
}

const SendButton = () => {
  const { id, collectionSlug, uploadStatus } = useDocumentInfo()
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const { code: locale } = useLocale()
  const { submit } = useForm()

  const send = useCallback(async () => {
    if (!collectionSlug || uploadStatus === 'uploading') return
    const search = `?locale=${locale}&depth=0&fallback-locale=null&draft=true`
    await submit({
      action: formatAdminURL({
        apiRoute: api,
        path: `/${collectionSlug}${id ? `/${id}` : ''}${search}`,
      }),
      method: id ? 'PATCH' : 'POST',
      overrides: { _status: 'draft', reviewState: 'submitted' },
    })
  }, [api, collectionSlug, id, locale, submit, uploadStatus])

  return (
    <FormSubmit
      buttonId="action-send-for-approval"
      onClick={() => void send()}
      size="medium"
      type="button"
    >
      {SEND_FOR_APPROVAL}
    </FormSubmit>
  )
}
