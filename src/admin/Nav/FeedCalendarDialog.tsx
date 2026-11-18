'use client'

import Link from 'next/link'
import { useEffect, useId, useRef } from 'react'

import styles from './Nav.module.css'

/**
 * An imported calendar, chosen in the Events panel (Jason, 2026-11-18: the message belongs not in
 * the list but in a modal once the calendar is chosen). Says where its events come from — "This
 * calendar is a feed from …" (`feedNote`) — and offers its events, read-only here, or Close.
 *
 * A NATIVE `<dialog>`, as the file library's delete: `showModal` traps focus, Escape closes it,
 * and focus goes back to the calendar's row (`onClosed`). Close is focused first, so Enter never
 * leaves the screen by accident.
 */
export const FeedCalendarDialog = ({
  name,
  note,
  eventsHref,
  onLeave,
  onClosed,
}: {
  name: string
  note: string
  eventsHref: string
  /** "See its events" was followed: the panel shuts as the address changes. */
  onLeave: () => void
  onClosed: () => void
}) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    el.showModal()
    close.current?.focus()
    el.addEventListener('close', onClosed)
    return () => el.removeEventListener('close', onClosed)
  }, [onClosed])

  return (
    <dialog
      aria-labelledby={titleId}
      className={styles.dialog}
      id="feed-calendar-dialog"
      ref={dialog}
    >
      <h2 className={styles.dialogTitle} id={titleId}>
        {name}
      </h2>
      <p className={styles.dialogText}>{note}</p>
      <div className={styles.dialogActions}>
        <button
          className={styles.flyoutClose}
          onClick={() => dialog.current?.close()}
          ref={close}
          type="button"
        >
          Close
        </button>
        <Link className={styles.flyoutAction} href={eventsHref} onClick={onLeave} prefetch={false}>
          See its events
        </Link>
      </div>
    </dialog>
  )
}
