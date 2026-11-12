'use client'

import {
  useConfig,
  useDocumentInfo,
  useForm,
  useFormFields,
  useFormModified,
  useLocale,
} from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { useCallback, useId, useRef, useState } from 'react'

import {
  CANCEL_SCHEDULE,
  dialogHeading,
  headerLabel,
  initialWhen,
  laterHint,
  primaryLabel,
  publishRequest,
  publishStateFor,
  toLocalInputValue,
  type PublishNoun,
  type PublishWhen,
} from './page-publish'
import styles from './PagePublishControl.module.css'

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  )

/**
 * The district's Publish on a page: ONE button, whose dialog asks "now or later" (Jason,
 * 2026-11-12; the Start chosen here instead of in Page settings since 2026-11-11). Fills the
 * `PublishButton` slot through `SendForApprovalButton`, so a school manager still gets "Send for
 * approval" and a page waiting in the queue still gets its link there.
 *
 * - Not on the site: "Publish" — the dialog opens on Now; Later shows a day-and-time.
 * - On the site: "Publish changes" — the same, for the change; the page stays up until its time.
 * - Scheduled: "Scheduled for <time>" / "Changes scheduled for <time>" — the dialog opens on
 *   Later with its time, to change it, publish now instead, or cancel the schedule.
 *
 * Each choice is one write (`page-publish.ts`): a publish for Now, a draft save marked
 * `scheduled` for Later, which the schedule job publishes at its time. The dialog is a
 * native `<dialog>` — modal, Escape to close, focus given back by the browser — with native radios
 * and a native day-and-time input, so nothing here re-implements a picker.
 *
 * Built, then locked with Playwright + axe (CLAUDE.md's exception for admin views):
 * `tests/e2e/page-publish.spec.ts`.
 */
export const PagePublishControl = () => {
  const {
    id,
    collectionSlug,
    hasPublishedDoc,
    unpublishedVersionCount,
    uploadStatus,
    setHasPublishedDoc,
    setUnpublishedVersionCount,
    setMostRecentVersionIsAutosaved,
  } = useDocumentInfo()
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const { code: locale } = useLocale()
  const { submit } = useForm()
  const modified = useFormModified()
  const reviewState = useFormFields(([fields]) => fields.reviewState?.value)
  const publishAt = useFormFields(([fields]) => fields.publishAt?.value)

  const dialog = useRef<HTMLDialogElement>(null)
  const [when, setWhen] = useState<PublishWhen>('now')
  const [value, setValue] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const ids = useId()
  const commentId = `${ids}-comment`
  const commentHintId = `${ids}-comment-hint`
  const headingId = `${ids}-heading`
  const nowId = `${ids}-now`
  const laterId = `${ids}-later`
  const inputId = `${ids}-at`
  const errorId = `${ids}-error`

  const state = publishStateFor({ live: Boolean(hasPublishedDoc), reviewState })
  const scheduledAt = typeof publishAt === 'string' && publishAt !== '' ? publishAt : null
  /**
   * As Payload's own Publish: a live page with nothing new has nothing to publish. Autosave leaves
   * the form unmodified, so a saved change counts by its unpublished version.
   */
  const nothingToPublish =
    state.live && !state.scheduled && !modified && (unpublishedVersionCount ?? 0) <= 0

  const send = useCallback(
    async (overrides: Record<string, unknown>, draft: boolean) => {
      if (!collectionSlug || uploadStatus === 'uploading') return null
      const search = `?locale=${locale}&depth=0&fallback-locale=null${draft ? '&draft=true' : ''}`
      return submit({
        action: formatAdminURL({
          apiRoute: api,
          path: `/${collectionSlug}${id ? `/${id}` : ''}${search}`,
        }),
        method: id ? 'PATCH' : 'POST',
        overrides,
      })
    },
    [api, collectionSlug, id, locale, submit, uploadStatus],
  )

  // Pages and announcements share the dialog (Jason, 2026-11-12); it names which.
  const noun: PublishNoun = collectionSlug === 'posts' ? 'announcement' : 'page'

  const openDialog = () => {
    setComment('')
    const first = initialWhen(state)
    setWhen(first)
    setValue(toLocalInputValue(scheduledAt))
    setRefusal(null)
    dialog.current?.showModal()
    // The choice already made has focus, not whichever radio comes first.
    document.getElementById(first === 'now' ? nowId : laterId)?.focus()
  }

  const choose = (next: PublishWhen) => {
    setWhen(next)
    setRefusal(null)
  }

  const confirm = async () => {
    const request = publishRequest(when, value, new Date(), comment)
    if (!request.ok) {
      setRefusal(request.refusal)
      document.getElementById(inputId)?.focus()
      return
    }
    dialog.current?.close()
    const result = await send(request.overrides, request.draft)
    // As Payload's own Publish does, so the header's status follows.
    if (result && when === 'now') {
      setUnpublishedVersionCount(0)
      setMostRecentVersionIsAutosaved(false)
      setHasPublishedDoc(true)
    }
  }

  const cancelSchedule = async () => {
    dialog.current?.close()
    await send(CANCEL_SCHEDULE, true)
  }

  return (
    <>
      <button
        className="btn btn--style-primary btn--size-medium"
        disabled={nothingToPublish || uploadStatus === 'uploading'}
        id="action-publish"
        onClick={openDialog}
        type="button"
      >
        {headerLabel(state, scheduledAt ? formatTime(scheduledAt) : null)}
      </button>

      <dialog aria-labelledby={headingId} className={styles.dialog} ref={dialog}>
        {/*
         * Not a <form>: this dialog sits inside Payload's document form, and a form in a form is
         * invalid HTML — its submit went to Payload's. Enter in the time does what the action does.
         */}
        <div className={styles.form}>
          <h2 className={styles.heading} id={headingId}>
            {dialogHeading(state, noun)}
          </h2>
          <fieldset className={styles.choices}>
            <legend className={styles.label}>When should it go live?</legend>
            <div className={styles.choice}>
              <input
                checked={when === 'now'}
                id={nowId}
                name={`${ids}-when`}
                onChange={() => choose('now')}
                type="radio"
                value="now"
              />
              <label htmlFor={nowId}>Now</label>
            </div>
            <div className={styles.choice}>
              <input
                checked={when === 'later'}
                id={laterId}
                name={`${ids}-when`}
                onChange={() => choose('later')}
                type="radio"
                value="later"
              />
              <label htmlFor={laterId}>At a set time</label>
            </div>
          </fieldset>

          {when === 'later' ? (
            <>
              <p className={styles.hint}>{laterHint(state, noun)}</p>
              <label className={styles.label} htmlFor={inputId}>
                Goes live on
              </label>
              <input
                aria-describedby={refusal ? errorId : undefined}
                aria-invalid={refusal ? true : undefined}
                className={styles.input}
                id={inputId}
                min={toLocalInputValue(new Date().toISOString())}
                onChange={(event) => {
                  setValue(event.target.value)
                  setRefusal(null)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  void confirm()
                }}
                type="datetime-local"
                value={value}
              />
            </>
          ) : null}
          {/* Optional (Jason, 2026-11-12): kept with this publish in the activity log and the
              history, and quoted in the email to the school when it approves their change. */}
          <label className={styles.label} htmlFor={commentId}>
            Comment
          </label>
          <span className={styles.hint} id={commentHintId}>
            Saved in this {noun}’s history.
          </span>
          <textarea
            aria-describedby={commentHintId}
            className={styles.comment}
            id={commentId}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            value={comment}
          />
          <p className={styles.error} id={errorId} role="alert">
            {refusal}
          </p>
          <div className={styles.actions}>
            <button
              className="btn btn--style-primary btn--size-medium"
              onClick={() => void confirm()}
              type="button"
            >
              {primaryLabel(state, when)}
            </button>
            {state.scheduled ? (
              <button
                className="btn btn--style-secondary btn--size-medium"
                onClick={() => void cancelSchedule()}
                type="button"
              >
                Cancel the schedule
              </button>
            ) : null}
            <button
              className="btn btn--style-secondary btn--size-medium"
              onClick={() => dialog.current?.close()}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
