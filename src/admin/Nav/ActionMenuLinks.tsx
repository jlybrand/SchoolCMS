'use client'

import { useNav } from '@payloadcms/ui'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { SiteChoice } from '@/admin/SitePages/site-pages'

import {
  DISTRICT_MENU,
  OPEN_PANEL_EVENT,
  SCHOOL_MENU,
  isCurrent,
  type PanelKind,
} from './action-menu'
import styles from './Nav.module.css'
import { SiteFlyout, type Plane } from './SiteFlyout'

const PANEL = 'site-flyout'
const KINDS: readonly PanelKind[] = ['pages', 'boards', 'calendars', 'files']

/**
 * The menu's links (`ActionMenu` reads the sites). Payload's `nav__link` class, so they sit with
 * the rest of the navigation; the current one is `aria-current`, as Payload marks its own.
 *
 * Pages, Announcements, Events and Files are BUTTONS: they slide out a list beside the menu (Jason,
 * 2026-11-18: a scrollable list, not a page with a select) that drills down in place
 * (`SiteFlyout`). A disclosure, not a modal: the button says whether it is open
 * (`aria-expanded`), the panel is a region labelled by its heading. Escape, a click outside, or
 * Close shut it and give focus back to whatever opened it; following a link out of it shuts it.
 *
 * The panel is PORTALLED to `<body>`: inside Payload's nav it would share the nav's stacking
 * context (and its `opacity: 0` while closed) and sit under the page. It starts at the nav's
 * inline end while the nav is open, at the window's edge while it is shut (`useNav`).
 *
 * A "Change site" / "Choose a folder" button on a screen opens the same panel
 * (`OpenPanelButton`, by `OPEN_PANEL_EVENT`).
 */
export const ActionMenuLinks = ({
  plane,
  sites,
}: {
  plane: Plane
  sites: readonly SiteChoice[]
}) => {
  const pathname = usePathname()
  const current = useSearchParams().get('site')
  const [kind, setKind] = useState<PanelKind | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const { navOpen } = useNav()
  const menu = plane === 'district' ? DISTRICT_MENU : SCHOOL_MENU

  const open = useCallback((next: PanelKind) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setKind(next)
  }, [])
  const close = useCallback((giveFocusBack: boolean) => {
    setKind(null)
    if (giveFocusBack) opener.current?.focus()
  }, [])

  // A "Change site" / "Choose a folder" button elsewhere on the screen.
  useEffect(() => {
    const onAsk = (event: Event) => {
      const asked = (event as CustomEvent<unknown>).detail
      if (KINDS.includes(asked as PanelKind)) open(asked as PanelKind)
    }
    window.addEventListener(OPEN_PANEL_EVENT, onAsk)
    return () => window.removeEventListener(OPEN_PANEL_EVENT, onAsk)
  }, [open])

  // Open (the panel focuses its own heading): Escape or a click outside shuts it.
  useEffect(() => {
    if (kind === null) return
    const onKey = (event: KeyboardEvent) => {
      // An open dialog in the panel takes its own Escape; the panel stays.
      if (event.key === 'Escape' && !panel.current?.querySelector('dialog[open]')) close(true)
    }
    const onPointer = (event: PointerEvent) => {
      const at = event.target as Node
      if (!panel.current?.contains(at) && !opener.current?.contains(at)) close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [kind, close])

  return (
    <>
      <ul
        aria-label={plane === 'district' ? 'District' : 'Your school'}
        className={styles.menu}
        id="action-menu"
      >
        {menu.map((item) => {
          const opens = item.panel
          return (
            <li key={item.id}>
              {opens ? (
                <button
                  aria-controls={PANEL}
                  aria-current={isCurrent(item, pathname) ? 'page' : undefined}
                  aria-expanded={kind === opens}
                  className={`nav__link ${styles.menuItem} ${styles.menuButton}`}
                  id={item.id}
                  onClick={() => (kind === opens ? close(false) : open(opens))}
                  type="button"
                >
                  {item.label}
                </button>
              ) : (
                <Link
                  aria-current={isCurrent(item, pathname) ? 'page' : undefined}
                  className={`nav__link ${styles.menuItem}`}
                  href={item.href}
                  id={item.id}
                  prefetch={false}
                >
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ul>

      {kind === null
        ? null
        : createPortal(
            <div
              aria-labelledby={`${PANEL}-title`}
              className={styles.flyout}
              data-beside-nav={navOpen}
              id={PANEL}
              ref={panel}
              role="region"
            >
              <SiteFlyout
                current={current}
                key={kind}
                kind={kind}
                onClose={() => close(true)}
                onLeave={() => setKind(null)}
                plane={plane}
                sites={sites}
              />
            </div>,
            document.body,
          )}
    </>
  )
}
