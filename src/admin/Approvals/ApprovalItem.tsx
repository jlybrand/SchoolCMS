'use client'

import { useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { checkPostDates, type PostDateField } from '@/lib/post-dates'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'

import { approvalAnchor } from './anchor'
import { ApprovalDates, inputToIso, NO_DATES, type DateInputs } from './ApprovalDates'
import { PageDiffView } from './PageDiffView'
import type { QueueItem } from './queue-data'
import { checkNote } from './request-changes'
import styles from './Approvals.module.css'

/**
 * One waiting page or announcement: who sent it, how long it has waited, the diff, and the two decisions.
 *
 * APPROVE IS ONE CLICK FROM THE DIFF (`04` §4.2) — no confirmation step, no opening the page.
 * It sends the token of the version on screen; if the school changed the page since, the
 * server refuses and this says so, with a reload. What goes live is what was read.
 *
 * Request changes opens a note in place and sends only with one. The note is checked here as
 * well as on the server, because the server's message is lost in the production build.
 *
 * Outcomes are announced in a `role="status"` region that replaces the actions, so focus is
 * moved to it and a screen-reader user hears what happened.
 *
 * `place` (Jason, 2026-11-12): in the queue, or on the document itself (`DocumentReview`). On the
 * document the way out is back to the queue, not "open" it. `onDecided` hears each decision, so
 * the document can bring its own header and form up to date (`DocumentApproval.tsx`).
 */
export type Decision = 'published' | 'scheduled' | 'sent-back'

export const ApprovalItem = ({
  item,
  place = 'queue',
  onDecided,
}: {
  item: QueueItem
  place?: 'queue' | 'document'
  onDecided?: (decision: Decision, outcome: string) => void
}) => {
  const onDocument = place === 'document'
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const router = useRouter()
  const id = useId()
  const titleId = `${id}-title`
  const noteId = `${id}-note`
  const commentId = `${id}-comment`
  const commentHintId = `${id}-comment-hint`
  const noteErrorId = `${id}-note-error`

  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle')
  const [noteOpen, setNoteOpen] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ text: string; reload: boolean } | null>(null)
  const [noteError, setNoteError] = useState<string | null>(null)
  /** The reviewer's optional comment on approving (Jason, 2026-11-12) — to the school's email. */
  const [comment, setComment] = useState('')
  // An announcement's dates (Jason, 2026-11-04); a page has none.
  const [dates, setDates] = useState<DateInputs>(NO_DATES)
  const [dateErrors, setDateErrors] = useState<Partial<Record<PostDateField, string>>>({})
  const hasDates = item.collection === 'posts'
  const isoDates = {
    publishAt: inputToIso(dates.publishAt),
    expiresAt: inputToIso(dates.expiresAt),
    featuredUntil: inputToIso(dates.featuredUntil),
  }
  const dateCheck = hasDates ? checkPostDates(isoDates, new Date()) : null
  /**
   * Said on the button before it is pressed: a future Start schedules rather than publishes. From
   * the Start alone, so a mistake in another date does not change what the button promises.
   */
  const schedules =
    hasDates && isoDates.publishAt !== null && isoDates.publishAt > new Date().toISOString()
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const outcomeRef = useRef<HTMLParagraphElement>(null)
  const problemRef = useRef<HTMLDivElement>(null)

  /**
   * Focus follows each outcome AFTER React has rendered it. Scheduling it on the next frame
   * instead raced the commit under load and left focus on a button that no longer existed.
   */
  useEffect(() => {
    if (phase === 'done') outcomeRef.current?.focus()
  }, [phase])
  useEffect(() => {
    if (problem) problemRef.current?.focus()
  }, [problem])
  useEffect(() => {
    if (noteOpen) noteRef.current?.focus()
  }, [noteOpen])

  const finish = (text: string, decision: Decision) => {
    setOutcome(text)
    setPhase('done')
    onDecided?.(decision, text)
  }

  const fail = (text: string, reload: boolean) => {
    setProblem({ text, reload })
    setPhase((p) => (p === 'busy' ? 'idle' : p))
  }

  const approve = async () => {
    // The same rules as the server's, so a wrong date is said here, beside the date.
    if (dateCheck && !dateCheck.ok) {
      setDateErrors(dateCheck.errors)
      return
    }
    setDateErrors({})
    setPhase('busy')
    setProblem(null)
    try {
      const res = await fetch(`${api}/${item.collection}/${String(item.id)}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...item.token,
          ...(hasDates ? isoDates : {}),
          ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
        }),
      })
      const body = (await res.json().catch(() => null)) as {
        error?: string
        reason?: string
        errors?: Partial<Record<PostDateField, string>>
      } | null
      if (res.ok)
        return schedules && isoDates.publishAt
          ? finish(
              `Approved. “${item.title}” goes live ${goesLive(isoDates.publishAt)}.`,
              'scheduled',
            )
          : finish(
              item.noun === 'announcement'
                ? `Published. “${item.title}” is approved for ${item.school}.`
                : `Published. “${item.title}” will be on ${item.school}’s site within a few seconds.`,
              'published',
            )
      if (body?.errors) setDateErrors(body.errors)
      fail(
        body?.error ?? `The ${item.noun} could not be approved. Please try again.`,
        body?.reason === 'changed',
      )
    } catch {
      fail(`The ${item.noun} could not be approved. Check your connection and try again.`, false)
    }
  }

  const openNote = () => {
    setNoteOpen(true)
    setProblem(null)
  }

  const sendBack = async () => {
    const check = checkNote(noteRef.current?.value)
    if (!check.ok) {
      setNoteError(check.error)
      noteRef.current?.focus()
      return
    }
    setNoteError(null)
    setPhase('busy')
    try {
      const res = await fetch(`${api}/${item.collection}/${String(item.id)}?draft=true&depth=0`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewState: 'changes-requested', reviewNote: check.note }),
      })
      if (res.ok) return finish(`Sent back to ${item.school} with your note.`, 'sent-back')
      fail(`The ${item.noun} could not be sent back. Reload and try again.`, true)
    } catch {
      fail(`The ${item.noun} could not be sent back. Check your connection and try again.`, false)
    }
  }

  return (
    <article
      aria-labelledby={titleId}
      className={styles.item}
      data-overdue={item.wait.overdue}
      // The target of "Review in the approval queue" on the page form — in the queue only.
      id={onDocument ? undefined : approvalAnchor(item.collection, item.id)}
      tabIndex={-1}
    >
      <header className={styles.itemHeader}>
        <h2 className={styles.itemTitle} id={titleId}>
          {item.title}
          {item.diff.isNew ? (
            <span className={styles.badge}>
              {item.noun === 'announcement' ? 'New announcement' : 'New page'}
            </span>
          ) : item.noun === 'announcement' ? (
            <span className={styles.badge}>Announcement</span>
          ) : null}
        </h2>
        <p className={styles.meta}>
          {item.school} · {item.submitter} · {item.wait.label}
          {item.wait.overdue ? (
            <strong className={styles.overdue}> · Waiting too long</strong>
          ) : null}
        </p>
      </header>

      {/* What the school wrote as it sent this (Jason, 2026-11-12), read before the diff. */}
      {item.comment !== '' ? (
        <div className={styles.schoolNote}>
          <p className={styles.schoolNoteLabel}>Note from {item.school}</p>
          <blockquote className={styles.schoolNoteText}>{item.comment}</blockquote>
        </div>
      ) : null}

      <PageDiffView diff={item.diff} titleId={titleId} />

      {hasDates && phase !== 'done' && !noteOpen ? (
        <ApprovalDates errors={dateErrors} onChange={setDates} values={dates} />
      ) : null}

      {problem ? (
        <div className={styles.problem} ref={problemRef} role="alert" tabIndex={-1}>
          <p>{problem.text}</p>
          {problem.reload ? (
            <button className={styles.secondary} onClick={() => router.refresh()} type="button">
              {onDocument ? `Reload the ${item.noun}` : 'Reload the queue'}
            </button>
          ) : null}
        </div>
      ) : null}

      {phase === 'done' ? (
        <p className={styles.outcome} ref={outcomeRef} role="status" tabIndex={-1}>
          {outcome}
        </p>
      ) : (
        <div className={styles.actions}>
          {noteOpen ? (
            <div className={styles.noteBox}>
              <label className={styles.noteLabel} htmlFor={noteId}>
                What needs to change?
              </label>
              <textarea
                aria-describedby={noteError ? noteErrorId : undefined}
                aria-invalid={noteError ? true : undefined}
                className={styles.note}
                id={noteId}
                ref={noteRef}
                rows={3}
              />
              {noteError ? (
                <p className={styles.noteError} id={noteErrorId}>
                  {noteError}
                </p>
              ) : null}
              <div className={styles.buttons}>
                <button
                  className={styles.primary}
                  disabled={phase === 'busy'}
                  onClick={() => void sendBack()}
                  type="button"
                >
                  Send back to the school
                </button>
                <button
                  className={styles.secondary}
                  disabled={phase === 'busy'}
                  onClick={() => {
                    setNoteOpen(false)
                    setNoteError(null)
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.approveComment}>
                <label className={styles.noteLabel} htmlFor={commentId}>
                  Comment
                </label>
                <span className={styles.dateHint} id={commentHintId}>
                  Sent to {item.school} with your approval, and kept in the history.
                </span>
                <textarea
                  aria-describedby={commentHintId}
                  className={styles.note}
                  disabled={phase === 'busy'}
                  id={commentId}
                  onChange={(event) => setComment(event.target.value)}
                  rows={2}
                  value={comment}
                />
              </div>
              <div className={styles.buttons}>
                <button
                  className={styles.primary}
                  disabled={phase === 'busy'}
                  onClick={() => void approve()}
                  type="button"
                >
                  {phase === 'busy'
                    ? schedules
                      ? 'Scheduling…'
                      : 'Publishing…'
                    : schedules
                      ? 'Approve and schedule'
                      : 'Approve and publish'}
                </button>
                <button
                  className={styles.secondary}
                  disabled={phase === 'busy'}
                  onClick={openNote}
                  type="button"
                >
                  Request changes
                </button>
                {onDocument ? (
                  <Link
                    className={styles.open}
                    href={`/admin/approvals#${approvalAnchor(item.collection, item.id)}`}
                  >
                    Review in the approval queue
                  </Link>
                ) : (
                  <Link
                    className={styles.open}
                    href={`/admin/collections/${item.collection}/${String(item.id)}`}
                  >
                    Open the {item.noun}
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </article>
  )
}

/** "on Nov 10, 2026, 8:00 AM" — in the district's time. */
const goesLive = (iso: string): string =>
  `on ${new Intl.DateTimeFormat('en-US', {
    timeZone: DISTRICT_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))}`
