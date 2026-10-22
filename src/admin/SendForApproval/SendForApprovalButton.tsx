'use client'

import {
  FormSubmit,
  PublishButton,
  useAuth,
  useConfig,
  useDocumentInfo,
  useForm,
  useFormFields,
  useLocale,
} from '@payloadcms/ui'
import Link from 'next/link'
import { formatAdminURL } from 'payload/shared'
import { useCallback } from 'react'

import type { AuthUser } from '@/access/types'

import { publishControlFor } from './review-status'
import './send-for-approval.css'

/** `04` §2.3 fixes this wording. Not "Save", not "Publish", not "Save draft". */
export const SEND_FOR_APPROVAL = 'Send for approval'

/**
 * Fills Payload's `PublishButton` slot on `pages` (`04` §2.3).
 *
 * Which control goes here is `publishControlFor`: a school manager gets the one button — and
 * would otherwise get NOTHING, since Payload's PublishButton renders null without publish
 * permission and autosave hides Save draft. A district admin gets Payload's own Publish, except
 * on a page waiting for approval, where they get a link to it in the approval queue.
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
  const reviewState = useFormFields(([fields]) => fields.reviewState?.value)
  const control = publishControlFor(user as AuthUser | null, reviewState)
  if (control === 'send') return <SendButton />
  if (control === 'queue') return <ReviewInQueue />
  return <PublishButton />
}

/**
 * In place of Publish on a page waiting for approval — see `publishControlFor`. A link, not a
 * disabled button: it says where approving happens and takes the reviewer there, to this page's
 * own entry.
 */
const ReviewInQueue = () => {
  const { id } = useDocumentInfo()
  return (
    <Link
      className="btn btn--style-primary btn--size-medium"
      href={`/admin/approvals#approval-${String(id)}`}
      id="action-review-in-queue"
    >
      Review in the approval queue
    </Link>
  )
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
