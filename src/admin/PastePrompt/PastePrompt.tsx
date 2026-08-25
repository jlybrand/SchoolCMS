'use client'

import { useEffect, useId, useRef } from 'react'

import type { HeadingCandidate, PasteRejection } from '@/lib/paste-normalizer'

import styles from './PastePrompt.module.css'

/**
 * The one question the paste normalizer asks (`07` §4.2).
 *
 * ============================================================================
 * ONE MODAL PER PASTE, CARRYING BOTH MESSAGES: what was removed, and whether
 * the bold lines were meant to be headings.
 * ============================================================================
 *
 * WHY A MODAL. The alternative was an inline banner above the editor. Against the usability
 * bar in CLAUDE.md — a school manager who last logged in five months ago, attended no
 * training and reads no documentation — an ignorable prompt is one that never gets answered,
 * and an unanswered heading question leaves a document whose structure exists only visually.
 * That is the failure this whole module exists to prevent, so the prompt blocks.
 *
 * WHY ONE SURFACE. Removals could have lived in their own banner. Folding them in costs one
 * interruption per paste instead of two, gives the axe gate one thing to check, and means the
 * removals are read rather than dismissed unseen.
 *
 * WHY THE QUESTION IS ALL-OR-NOTHING. `07` §4.2 fixes the wording as a single question, and a
 * per-line checklist would require the author to understand what a heading is in order to
 * answer. The lines are listed so the answer is informed; the answer is still one yes.
 *
 * NOTHING IS INSERTED UNTIL THIS RESOLVES, so every exit inserts — including Escape and the
 * backdrop, which resolve as "no". An author must not be able to lose a pasted agenda by
 * pressing a key that means "go away".
 *
 * A NATIVE `<dialog>`, not a hand-built one. Focus moving in, focus trapped, Escape, focus
 * restored to the editor on close, and the background made inert are exactly what the element
 * does, and each is a thing a bespoke modal gets subtly wrong. Payload's own modal was the
 * other option; it would mean adopting `@payloadcms/ui` as a directly pinned dependency to
 * get behaviour the platform already has.
 */

export type PastePromptProps = {
  readonly open: boolean
  readonly rejections: readonly PasteRejection[]
  readonly candidates: readonly HeadingCandidate[]
  /**
   * Always inserts the pasted content. `promote` is the answer to the heading question —
   * false when there was nothing to ask, when the author said no, and when they dismissed.
   */
  readonly onResolve: (promote: boolean) => void
}

/** `07` §4.2 fixes this wording. Do not paraphrase it. */
export const HEADING_QUESTION = 'These lines look like headings. Mark them as headings?'

export const PastePrompt = ({ open, rejections, candidates, onResolve }: PastePromptProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    // `showModal` is what puts the dialog in the top layer and makes the rest inert; the
    // `open` attribute alone does neither.
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const asksAboutHeadings = candidates.length > 0
  const reportsRemovals = rejections.length > 0

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape. Handled rather than allowed to close on its own, so the paste still lands.
        event.preventDefault()
        onResolve(false)
      }}
    >
      <div className={styles.body}>
        <h2 className={styles.title} id={titleId}>
          {reportsRemovals ? 'We cleaned up your pasted content' : 'Check your pasted text'}
        </h2>

        {reportsRemovals ? (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Removed</h3>
            <ul className={styles.list}>
              {rejections.map((rejection) => (
                <li key={rejection.kind}>{rejection.message}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {asksAboutHeadings ? (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{HEADING_QUESTION}</h3>
            <ul className={styles.list}>
              {candidates.map((candidate) => (
                <li className={styles.candidate} key={candidate.blockIndex}>
                  {candidate.text}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className={styles.actions}>
          {asksAboutHeadings ? (
            <>
              <button className={styles.button} onClick={() => onResolve(false)} type="button">
                No, keep as text
              </button>
              <button
                autoFocus
                className={`${styles.button} ${styles.primary}`}
                onClick={() => onResolve(true)}
                type="button"
              >
                Yes
              </button>
            </>
          ) : (
            <button
              autoFocus
              className={`${styles.button} ${styles.primary}`}
              onClick={() => onResolve(false)}
              type="button"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </dialog>
  )
}
