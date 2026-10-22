'use client'

import { useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { PageDiffView } from './PageDiffView'
import type { QueueItem } from './queue-data'
import { checkNote } from './request-changes'
import styles from './Approvals.module.css'

/**
 * One waiting page: who sent it, how long it has waited, the diff, and the two decisions.
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
 */
export const ApprovalItem = ({ item }: { item: QueueItem }) => {
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const router = useRouter()
  const id = useId()
  const titleId = `${id}-title`
  const noteId = `${id}-note`
  const noteErrorId = `${id}-note-error`

  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle')
  const [noteOpen, setNoteOpen] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ text: string; reload: boolean } | null>(null)
  const [noteError, setNoteError] = useState<string | null>(null)
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

  const finish = (text: string) => {
    setOutcome(text)
    setPhase('done')
  }

  const fail = (text: string, reload: boolean) => {
    setProblem({ text, reload })
    setPhase((p) => (p === 'busy' ? 'idle' : p))
  }

  const approve = async () => {
    setPhase('busy')
    setProblem(null)
    try {
      const res = await fetch(`${api}/pages/${String(item.id)}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.token),
      })
      const body = (await res.json().catch(() => null)) as {
        error?: string
        reason?: string
      } | null
      if (res.ok)
        return finish(
          `Published. “${item.title}” will be on ${item.school}’s site within a few seconds.`,
        )
      fail(
        body?.error ?? 'The page could not be approved. Please try again.',
        body?.reason === 'changed',
      )
    } catch {
      fail('The page could not be approved. Check your connection and try again.', false)
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
      const res = await fetch(`${api}/pages/${String(item.id)}?draft=true&depth=0`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewState: 'changes-requested', reviewNote: check.note }),
      })
      if (res.ok) return finish(`Sent back to ${item.school} with your note.`)
      fail('The page could not be sent back. Reload and try again.', true)
    } catch {
      fail('The page could not be sent back. Check your connection and try again.', false)
    }
  }

  return (
    <article
      aria-labelledby={titleId}
      className={styles.item}
      data-overdue={item.wait.overdue}
      // The target of "Review in the approval queue" on the page form.
      id={`approval-${String(item.id)}`}
      tabIndex={-1}
    >
      <header className={styles.itemHeader}>
        <h2 className={styles.itemTitle} id={titleId}>
          {item.title}
          {item.diff.isNew ? <span className={styles.badge}>New page</span> : null}
        </h2>
        <p className={styles.meta}>
          {item.school} · {item.submitter} · {item.wait.label}
          {item.wait.overdue ? (
            <strong className={styles.overdue}> · Waiting too long</strong>
          ) : null}
        </p>
      </header>

      <PageDiffView diff={item.diff} titleId={titleId} />

      {problem ? (
        <div className={styles.problem} ref={problemRef} role="alert" tabIndex={-1}>
          <p>{problem.text}</p>
          {problem.reload ? (
            <button className={styles.secondary} onClick={() => router.refresh()} type="button">
              Reload the queue
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
            <div className={styles.buttons}>
              <button
                className={styles.primary}
                disabled={phase === 'busy'}
                onClick={() => void approve()}
                type="button"
              >
                {phase === 'busy' ? 'Publishing…' : 'Approve and publish'}
              </button>
              <button
                className={styles.secondary}
                disabled={phase === 'busy'}
                onClick={openNote}
                type="button"
              >
                Request changes
              </button>
              <Link className={styles.open} href={`/admin/collections/pages/${String(item.id)}`}>
                Open the page
              </Link>
            </div>
          )}
        </div>
      )}
    </article>
  )
}
