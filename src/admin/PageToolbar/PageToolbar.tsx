'use client'

import {
  ConfirmationModal,
  toast,
  useConfig,
  useDocumentInfo,
  useFormFields,
  useModal,
} from '@payloadcms/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  firstRefusedTab,
  HEADING_ID,
  missingRequired,
  PANEL_ID,
  REFUSED_EVENT,
  SETTING_PATHS,
  SETTINGS_EVENT,
  TAB_EVENT,
  tabFor,
  tabId,
  type SettingsTab,
} from './page-settings'
import './page-settings.css'
import styles from './PageToolbar.module.css'

const DELETE_SLUG = 'dd2-delete-page'
const UNPUBLISH_SLUG = 'dd2-unpublish-page'

/**
 * The district's page toolbar (Jason, 2026-10-29) — his Finalsite workflow: the page's
 * contents above, and along the bottom History, Clone, Delete, Unpublish and the gear that
 * opens Page settings. Save and Publish stay where Payload puts them.
 *
 * A `ui` field last in the form, the district's only (its `condition`), and only on a saved
 * page — a new page has no history to show or record to clone, and keeps its settings inline
 * so it can be given a title at all.
 *
 * THE DIALOG IS THE FORM ITSELF. The settings are Payload's own fields, marked with
 * `SETTING_CLASS` where they are declared (`src/collections/Pages.ts`); opening the dialog turns
 * Payload's form area into it and shows only those (`page-settings.css`). So nothing is
 * re-rendered or moved: the values, validation and autosave are Payload's as ever, and a school
 * manager — who has no toolbar — sees the same fields in their usual places. What this adds is
 * the dialog's behaviour: `role="dialog"`, focus moved in and given back, Escape, and the rest of
 * the screen made `inert` while it is open — and, since 2026-11-11, its tabs: the main column's
 * fields become the `tabpanel` the header's tabs control (`PageSettingsHeader.tsx`).
 *
 * Built, then locked with a Playwright flow and axe (CLAUDE.md's exception for admin views):
 * `tests/e2e/page-toolbar.spec.ts`.
 */
export const PageToolbar = () => {
  const { id, collectionSlug, hasPublishedDoc } = useDocumentInfo()
  const {
    config: {
      routes: { admin: adminRoute, api },
    },
  } = useConfig()
  const router = useRouter()
  const { openModal } = useModal()
  const gearRef = useRef<HTMLButtonElement>(null)
  const restore = useRef<(() => void) | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  /**
   * The tab holding a setting the last save refused, so the dialog opens on it rather than hiding
   * it — on that tab, not just the first.
   */
  const refusedTab = useFormFields(([fields]) =>
    firstRefusedTab(SETTING_PATHS.filter((path) => fields[path]?.valid === false)),
  )

  const title = useFormFields(([fields]) => fields.title?.value)
  const slug = useFormFields(([fields]) => fields.slug?.value)

  const close = useCallback(() => {
    /** A page with no title or no address stays in the dialog, which says why. */
    const missing = restore.current ? missingRequired({ title, slug }) : null
    if (missing) {
      showTab(tabFor(missing.path) ?? 'page')
      window.dispatchEvent(new CustomEvent(REFUSED_EVENT, { detail: missing.label }))
      document.querySelector<HTMLElement>(`#field-${missing.path}`)?.focus()
      return
    }
    restore.current?.()
    restore.current = null
    setOpen(false)
    gearRef.current?.focus()
  }, [title, slug])

  const openSettings = useCallback((tab: SettingsTab = 'page') => {
    const dialog = document.querySelector<HTMLElement>('.document-fields')
    if (!dialog || restore.current) return

    dialog.dataset.pageSettings = 'open'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', HEADING_ID)

    /** Every setting is in the main column (`src/collections/Pages.ts`), so it is the one panel. */
    const panel = dialog.querySelector<HTMLElement>('.document-fields__fields')
    panel?.setAttribute('role', 'tabpanel')
    panel?.setAttribute('id', PANEL_ID)
    panel?.setAttribute('aria-labelledby', tabId(tab))
    showTab(tab)

    /**
     * Everything outside the dialog goes `inert`: not focusable, not clickable, not read. Walked
     * from the dialog up to `<body>`, so the header, the nav and the toast area are all covered
     * without naming any of Payload's elements.
     */
    const inerted: HTMLElement[] = []
    for (let node: HTMLElement | null = dialog; node && node !== document.body;) {
      const parent: HTMLElement | null = node.parentElement
      for (const sibling of Array.from(parent?.children ?? [])) {
        if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
          sibling.inert = true
          inerted.push(sibling)
        }
      }
      node = parent
    }

    restore.current = () => {
      delete dialog.dataset.pageSettings
      panel?.removeAttribute('role')
      panel?.removeAttribute('id')
      panel?.removeAttribute('aria-labelledby')
      dialog.removeAttribute('role')
      dialog.removeAttribute('aria-modal')
      dialog.removeAttribute('aria-labelledby')
      for (const el of inerted) el.inert = false
    }
    setOpen(true)
    // After the styles apply, so the heading is visible and can take focus.
    requestAnimationFrame(() => document.getElementById(HEADING_ID)?.focus())
  }, [])

  // The dialog's Close and Done, and Escape.
  useEffect(() => {
    const onEvent = () => close()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && restore.current) {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener(SETTINGS_EVENT, onEvent)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(SETTINGS_EVENT, onEvent)
      document.removeEventListener('keydown', onKey)
    }
  }, [close])

  // A refused setting would otherwise be an error nobody can see — on its own tab, too.
  useEffect(() => {
    if (!refusedTab) return
    if (open) showTab(refusedTab)
    else openSettings(refusedTab)
  }, [refusedTab, open, openSettings])

  // Leaving the page with the dialog open must not leave the next screen inert.
  useEffect(() => () => restore.current?.(), [])

  if (id === undefined || id === null || id === '') return null

  const clone = async () => {
    setBusy(true)
    try {
      // `draft` defaults to true on this endpoint: the copy is a draft.
      const res = await fetch(`${api}/${collectionSlug}/${id}/duplicate?depth=0`, {
        method: 'POST',
        credentials: 'include',
      })
      const body = (await res.json().catch(() => null)) as { doc?: { id?: unknown } } | null
      if (res.ok && body?.doc?.id !== undefined) {
        toast.success('Copied. You are now editing the copy.')
        router.push(`${adminRoute}/collections/${collectionSlug}/${String(body.doc.id)}`)
        return
      }
      toast.error('That page could not be copied. Please try again.')
    } catch {
      toast.error('That page could not be copied. Please try again.')
    }
    setBusy(false)
  }

  const remove = async () => {
    const res = await fetch(`${api}/${collectionSlug}/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => null)
    if (res?.ok) {
      toast.success('The page was deleted.')
      router.push(`${adminRoute}/collections/${collectionSlug}`)
      return
    }
    toast.error('That page could not be deleted. Please try again.')
  }

  /**
   * Payload's own unpublish, as its "⋯" menu sends it: a save of `_status: 'draft'` with no
   * draft flag. Ours rather than Payload's `UnpublishButton`, which renders unstyled outside
   * Payload's header and repeats the menu item's id. The page leaves the site at once —
   * `liveStillPublished` tells the revalidation hook this was an unpublish.
   */
  const unpublish = async () => {
    const res = await fetch(`${api}/${collectionSlug}/${id}?depth=0`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _status: 'draft' }),
    }).catch(() => null)
    if (res?.ok) {
      toast.success('The page is no longer on the site. It is kept as a draft.')
      router.refresh()
      return
    }
    toast.error('That page could not be unpublished. Please try again.')
  }

  return (
    <div className={styles.toolbar} id="page-toolbar" role="group" aria-label="Page actions">
      <Link
        className={styles.button}
        href={`${adminRoute}/collections/${collectionSlug}/${String(id)}/versions`}
      >
        History
      </Link>
      <button className={styles.button} disabled={busy} onClick={() => void clone()} type="button">
        Clone
      </button>
      <button className={styles.button} onClick={() => openModal(DELETE_SLUG)} type="button">
        Delete
      </button>
      {hasPublishedDoc ? (
        <button
          className={styles.button}
          id="page-toolbar-unpublish"
          onClick={() => openModal(UNPUBLISH_SLUG)}
          type="button"
        >
          Unpublish
        </button>
      ) : null}
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${styles.button} ${styles.gear}`}
        onClick={() => openSettings()}
        ref={gearRef}
        type="button"
      >
        <GearIcon />
        Page settings
      </button>

      <ConfirmationModal
        body="It leaves the site now and is kept as a draft. Publish it again to bring it back."
        confirmLabel="Unpublish the page"
        heading="Take this page off the site?"
        modalSlug={UNPUBLISH_SLUG}
        onConfirm={unpublish}
      />
      <ConfirmationModal
        body="The page and its history are removed for good. Links to it will stop working."
        confirmLabel="Delete the page"
        heading="Delete this page?"
        modalSlug={DELETE_SLUG}
        onConfirm={remove}
      />
    </div>
  )
}

/** Asks the dialog's header to show a tab (it owns the tabs; `PageSettingsHeader.tsx`). */
const showTab = (tab: SettingsTab) =>
  window.dispatchEvent(new CustomEvent<SettingsTab>(TAB_EVENT, { detail: tab }))

const GearIcon = () => (
  <svg
    aria-hidden="true"
    fill="none"
    focusable="false"
    height="16"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="16"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)
