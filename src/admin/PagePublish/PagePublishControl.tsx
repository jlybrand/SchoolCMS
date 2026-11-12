'use client'

import {
  FormSubmit,
  PublishButton,
  useConfig,
  useDocumentInfo,
  useForm,
  useFormFields,
  useLocale,
} from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { useCallback, useId, useRef, useState } from 'react'

import {
  CANCEL_SCHEDULE,
  PUBLISH_NOW,
  publishOfferFor,
  scheduleFor,
  scheduleRefusal,
  toLocalInputValue,
} from './page-publish'
import styles from './PagePublishControl.module.css'

const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  )

/**
 * The district's Publish on a page (Jason, 2026-11-11): "Publish now" or "Schedule…", the Start
 * chosen here instead of in Page settings. Fills the `PublishButton` slot through
 * `SendForApprovalButton`, so a school manager still gets "Send for approval" and a page waiting
 * in the queue still gets its link there.
 *
 * - Not on the site: Schedule… and Publish now.
 * - Scheduled: its time (opening the same dialog — change it or cancel it) and Publish now.
 * - On the site: Payload's own "Publish changes". A live page cannot be scheduled.
 *
 * Each choice is one write (`page-publish.ts`); the server does the scheduling. The time is
 * picked in a native `<dialog>` — modal, Escape to close, focus given back by the browser — with
 * a native day-and-time input, so nothing here re-implements a date picker.
 *
 * Built, then locked with Playwright + axe (CLAUDE.md's exception for admin views):
 * `tests/e2e/page-publish.spec.ts`.
 */
export const PagePublishControl = () => {
  const {
    id,
    collectionSlug,
    hasPublishedDoc,
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
  const reviewState = useFormFields(([fields]) => fields.reviewState?.value)
  const publishAt = useFormFields(([fields]) => fields.publishAt?.value)

  const dialog = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const ids = useId()
  const headingId = `${ids}-heading`
  const inputId = `${ids}-at`
  const errorId = `${ids}-error`

  const offer = publishOfferFor({ live: Boolean(hasPublishedDoc), reviewState })
  const scheduledAt = typeof publishAt === 'string' && publishAt !== '' ? publishAt : null

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

  const publishNow = async () => {
    const result = await send(PUBLISH_NOW, false)
    // As Payload's own Publish does, so the header's status follows.
    if (result) {
      setUnpublishedVersionCount(0)
      setMostRecentVersionIsAutosaved(false)
      setHasPublishedDoc(true)
    }
  }

  const openDialog = () => {
    setValue(toLocalInputValue(scheduledAt))
    setRefusal(null)
    dialog.current?.showModal()
  }

  const schedule = async () => {
    const why = scheduleRefusal(value, new Date())
    if (why) {
      setRefusal(why)
      document.getElementById(inputId)?.focus()
      return
    }
    dialog.current?.close()
    await send(scheduleFor(new Date(value).toISOString()), false)
  }

  const cancelSchedule = async () => {
    dialog.current?.close()
    await send(CANCEL_SCHEDULE, true)
  }

  if (offer === 'live') return <PublishButton />

  return (
    <>
      <button
        className="btn btn--style-secondary btn--size-medium"
        id="action-schedule"
        onClick={openDialog}
        type="button"
      >
        {offer === 'scheduled' && scheduledAt ? `Scheduled for ${when(scheduledAt)}` : 'Schedule…'}
      </button>
      <FormSubmit
        buttonId="action-publish-now"
        onClick={() => void publishNow()}
        size="medium"
        type="button"
      >
        Publish now
      </FormSubmit>

      <dialog aria-labelledby={headingId} className={styles.dialog} ref={dialog}>
        {/*
         * Not a <form>: this dialog sits inside Payload's document form, and a form in a form is
         * invalid HTML — its submit went to Payload's. Enter in the time does what Schedule does.
         */}
        <div className={styles.form}>
          <h2 className={styles.heading} id={headingId}>
            {offer === 'scheduled' ? 'Change when this page goes live' : 'Schedule this page'}
          </h2>
          <p className={styles.hint}>
            It stays off the site until then, and goes live on its own at that time.
          </p>
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
              void schedule()
            }}
            type="datetime-local"
            value={value}
          />
          <p className={styles.error} id={errorId} role="alert">
            {refusal}
          </p>
          <div className={styles.actions}>
            <button
              className="btn btn--style-primary btn--size-medium"
              onClick={() => void schedule()}
              type="button"
            >
              {offer === 'scheduled' ? 'Save the new time' : 'Schedule'}
            </button>
            {offer === 'scheduled' ? (
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
