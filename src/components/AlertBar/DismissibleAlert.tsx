'use client'

import { useState, useSyncExternalStore, type ReactNode } from 'react'

import type { SiteAlert } from '@/content/types'

import styles from './AlertBar.module.css'

/**
 * An info or warning banner a visitor may close for their visit (Jason, 2026-11-12). Remembered in
 * `sessionStorage` — this tab, this visit — keyed by the alert AND its version, so a banner whose
 * words change comes back. A visitor preference, not application state (CLAUDE.md bans
 * `localStorage` for the latter), and nothing is sent anywhere.
 *
 * The close button names what it closes ("Close: Warning"), since several banners may sit
 * together. Shown from the server's markup first, so it never pops in after the page draws.
 */
/** Closed earlier this visit? Read from the browser; on the server, never. */
const wasClosed = (key: string): boolean => {
  try {
    return window.sessionStorage.getItem(key) === '1'
  } catch {
    return false // Storage refused (a private window, a policy): the banner simply stays.
  }
}

const onStorage = (changed: () => void) => {
  window.addEventListener('storage', changed)
  return () => window.removeEventListener('storage', changed)
}

export const DismissibleAlert = ({
  id,
  version,
  severity,
  closeLabel,
  children,
}: {
  id: string
  version: string
  severity: SiteAlert['severity']
  closeLabel: string
  children: ReactNode
}) => {
  const key = `dd2-alert-closed:${id}:${version}`
  const closedBefore = useSyncExternalStore(
    onStorage,
    () => wasClosed(key),
    () => false,
  )
  const [closed, setClosed] = useState(false)

  if (closed || closedBefore) return null
  return (
    <div className={styles.alert} data-severity={severity}>
      {children}
      <button
        aria-label={`${closeLabel}: ${severity === 'warning' ? 'Warning' : 'Notice'}`}
        className={styles.close}
        onClick={() => {
          setClosed(true)
          try {
            window.sessionStorage.setItem(key, '1')
          } catch {
            // Closed for this page view at least.
          }
        }}
        type="button"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  )
}
