'use client'

import { useEffect, useState } from 'react'

import { HEADING_ID, REFUSED_EVENT, SETTING_CLASS, SETTINGS_EVENT } from './page-settings'
import styles from './PageToolbar.module.css'

const close = () => window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: 'close' }))

/**
 * The Page settings dialog's heading and Close — a `ui` field first in the form, so it is the
 * first thing in the dialog. Shown only while the dialog is open (`page-settings.css`); the
 * district's only (its `condition`).
 */
export const PageSettingsHeader = () => {
  /** Why the dialog stayed open, announced (`role="alert"`) and cleared once fixed. */
  const [missing, setMissing] = useState<string | null>(null)
  useEffect(() => {
    const onRefused = (event: Event) => setMissing(String((event as CustomEvent).detail))
    const onClose = () => setMissing(null)
    window.addEventListener(REFUSED_EVENT, onRefused)
    window.addEventListener(SETTINGS_EVENT, onClose)
    return () => {
      window.removeEventListener(REFUSED_EVENT, onRefused)
      window.removeEventListener(SETTINGS_EVENT, onClose)
    }
  }, [])

  return (
    <div className={`${SETTING_CLASS} ${styles.dialogHeader}`} id="page-settings-header">
      <h2 className={styles.dialogTitle} id={HEADING_ID} tabIndex={-1}>
        Page settings
      </h2>
      <button className={styles.button} onClick={close} type="button">
        Close
      </button>
      <p className={styles.refused} role="alert">
        {missing ? `The page needs ${missing} before you close this.` : null}
      </p>
    </div>
  )
}

/** The dialog's last control — "Done" after the last setting, so nobody has to scroll back up. */
export const PageSettingsFooter = () => (
  <div className={`${SETTING_CLASS} ${styles.dialogFooter}`} id="page-settings-footer">
    <p className={styles.hint}>
      Changes here are part of the page. Publish the page to put them on the site.
    </p>
    <button className={styles.button} onClick={close} type="button">
      Done
    </button>
  </div>
)
