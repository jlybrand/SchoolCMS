'use client'

import {
  FormSubmit,
  PublishButton,
  toast,
  useAuth,
  useConfig,
  useDocumentInfo,
  useForm,
  useFormFields,
  useLocale,
} from '@payloadcms/ui'
import Link from 'next/link'
import { formatAdminURL } from 'payload/shared'
import { useCallback, useId, useState } from 'react'

import type { AuthUser } from '@/access/types'
import { approvalAnchor } from '@/admin/Approvals/anchor'
import { PagePublishControl } from '@/admin/PagePublish/PagePublishControl'

import { publishControlFor, sendRefusal } from './review-status'

import './send-for-approval.css'

/** `04` §2.3 fixes this wording. Not "Save", not "Publish", not "Save draft". */
export const SEND_FOR_APPROVAL = 'Send for approval'

/**
 * Fills Payload's `PublishButton` slot on `pages` and `posts` (`04` §2.3).
 *
 * Which control goes here is `publishControlFor`: a school manager gets the one button — and
 * would otherwise get NOTHING, since Payload's PublishButton renders null without publish
 * permission and autosave hides Save draft. A district admin gets Payload's own Publish, except
 * on a page waiting for approval, where they get a link to it in the approval queue — and on a
 * PAGE, one Publish button whose dialog asks now or later (`PagePublishControl`, Jason
 * 2026-11-11 / 2026-11-12).
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
  return <DistrictPublish />
}

/**
 * Pages choose their Start when publishing (Jason, 2026-11-11), and announcements do too: they get
 * the same dialog, with its optional comment (Jason, 2026-11-12). Anything else keeps Payload's.
 */
const DistrictPublish = () => {
  const { collectionSlug } = useDocumentInfo()
  return collectionSlug === 'pages' || collectionSlug === 'posts' ? (
    <PagePublishControl />
  ) : (
    <PublishButton />
  )
}

/**
 * In place of Publish on a page waiting for approval — see `publishControlFor`. A link, not a
 * disabled button: it takes the reviewer to this page's own entry in the queue. SECONDARY since
 * the review panel on the page itself holds Approve (Jason, 2026-11-12: the queue link stays, as
 * the secondary way).
 */
const ReviewInQueue = () => {
  const { id, collectionSlug } = useDocumentInfo()
  return (
    <Link
      className="btn btn--style-secondary btn--size-medium"
      href={`/admin/approvals#${approvalAnchor(collectionSlug ?? 'pages', id ?? '')}`}
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

  const body = useFormFields(([fields]) => fields.body?.value)
  /**
   * The optional note for the district (Jason, 2026-11-12: a box beside the button, so sending
   * stays one click). Local, not a form field, so autosave never sends it; it goes with the send
   * as `changeComment` and lands on the submit's activity-log entry, the queue and the digest.
   */
  const [note, setNote] = useState('')
  const noteId = useId()

  const send = useCallback(async () => {
    if (!collectionSlug || uploadStatus === 'uploading') return
    // Stopped before anything is sent — see `sendRefusal` for why not leave it to the server.
    const refusal = sendRefusal(collectionSlug, body)
    if (refusal) {
      toast.error(refusal)
      return
    }
    const search = `?locale=${locale}&depth=0&fallback-locale=null&draft=true`
    const result = await submit({
      action: formatAdminURL({
        apiRoute: api,
        path: `/${collectionSlug}${id ? `/${id}` : ''}${search}`,
      }),
      method: id ? 'PATCH' : 'POST',
      overrides: {
        _status: 'draft',
        reviewState: 'submitted',
        ...(note.trim() === '' ? {} : { changeComment: note.trim() }),
      },
    })
    if (result) setNote('')
  }, [api, body, collectionSlug, id, locale, note, submit, uploadStatus])

  return (
    <div className="send-for-approval">
      <div className="send-for-approval__note">
        <label className="send-for-approval__label" htmlFor={noteId}>
          Note for the district
        </label>
        <input
          className="send-for-approval__input"
          id={noteId}
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
          type="text"
          value={note}
        />
      </div>
      <FormSubmit
        buttonId="action-send-for-approval"
        onClick={() => void send()}
        size="medium"
        type="button"
      >
        {SEND_FOR_APPROVAL}
      </FormSubmit>
    </div>
  )
}
