'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'

import {
  HEADING_ID,
  PANEL_ID,
  REFUSED_EVENT,
  SETTING_CLASS,
  SETTING_TABS,
  SETTINGS_EVENT,
  TAB_EVENT,
  tabAfterKey,
  tabId,
  type SettingsTab,
} from './page-settings'
import styles from './PageToolbar.module.css'

const close = () => window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: 'close' }))

/**
 * The Page settings dialog's heading, Close and tabs — a `ui` field first in the form, so it is
 * the first thing in the dialog. Shown only while the dialog is open (`page-settings.css`); the
 * district's only (its `condition`).
 *
 * THE TABS (Jason, 2026-11-11): Page · Linking · SEO · Access, the WAI-ARIA tabs pattern —
 * `tablist`, `tab`s with `aria-selected`, one tab stop (roving `tabIndex`), arrow keys, Home and
 * End, activating as they move. The fields are Payload's, where they always are; which tab shows
 * is `data-settings-tab` on the form (`.document-fields`), and `page-settings.css` hides the
 * other tabs' settings. The panel is the main column's fields, which the toolbar marks
 * `role="tabpanel"` when the dialog opens; this keeps its `aria-labelledby` on the open tab.
 *
 * The toolbar picks the tab (`TAB_EVENT`) when a refused setting opens the dialog, so the field
 * with the error is on screen.
 */
export const PageSettingsHeader = () => {
  /** Why the dialog stayed open, announced (`role="alert"`) and cleared once fixed. */
  const [missing, setMissing] = useState<string | null>(null)
  const [active, setActive] = useState<SettingsTab>('page')
  const tabs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({})

  /**
   * Applied to the form AT ONCE, not after a render: the toolbar focuses a refused field straight
   * after asking for its tab, and a field still hidden cannot take focus.
   */
  const show = useCallback((tab: SettingsTab) => {
    const form = document.querySelector<HTMLElement>('.document-fields')
    if (form) form.dataset.settingsTab = tab
    document.getElementById(PANEL_ID)?.setAttribute('aria-labelledby', tabId(tab))
    setActive(tab)
  }, [])

  // The toolbar asks for a tab every time it opens the dialog, so each opening starts on one.
  useEffect(() => {
    const onRefused = (event: Event) => setMissing(String((event as CustomEvent).detail))
    const onClose = () => setMissing(null)
    const onTab = (event: Event) => show((event as CustomEvent<SettingsTab>).detail)
    window.addEventListener(REFUSED_EVENT, onRefused)
    window.addEventListener(SETTINGS_EVENT, onClose)
    window.addEventListener(TAB_EVENT, onTab)
    return () => {
      window.removeEventListener(REFUSED_EVENT, onRefused)
      window.removeEventListener(SETTINGS_EVENT, onClose)
      window.removeEventListener(TAB_EVENT, onTab)
    }
  }, [show])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'
    const next = tabAfterKey(active, event.key, direction)
    if (!next) return
    event.preventDefault()
    show(next)
    tabs.current[next]?.focus()
  }

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
      <div aria-labelledby={HEADING_ID} className={styles.tabs} role="tablist">
        {SETTING_TABS.map((tab) => (
          <button
            aria-controls={PANEL_ID}
            aria-selected={tab.id === active}
            className={styles.tab}
            id={tabId(tab.id)}
            key={tab.id}
            onClick={() => show(tab.id)}
            onKeyDown={onKeyDown}
            ref={(el) => {
              tabs.current[tab.id] = el
            }}
            role="tab"
            tabIndex={tab.id === active ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
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
