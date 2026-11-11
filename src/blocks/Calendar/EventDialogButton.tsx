'use client'

import type { ReactNode } from 'react'

/**
 * Opens an event's details (Jason, 2026-11-11: "clicking on an event in the calendar reveals its
 * note"). The dialog itself is server-rendered, native `<dialog>`: the browser keeps focus inside
 * it, closes it on Escape, and returns focus here. This button is the only script it needs.
 */
export type EventDialogButtonProps = {
  readonly dialogId: string
  readonly className?: string
  readonly children: ReactNode
}

export const EventDialogButton = ({ dialogId, className, children }: EventDialogButtonProps) => (
  <button
    aria-haspopup="dialog"
    className={className}
    onClick={() => {
      const dialog = document.getElementById(dialogId)
      if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal()
    }}
    type="button"
  >
    {children}
  </button>
)
