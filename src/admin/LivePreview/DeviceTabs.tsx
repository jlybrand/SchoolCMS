'use client'

import { useLivePreviewContext } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { DEVICE_TABS, deviceWidth, firstDevice, fitZoom } from './device-tabs'

import './device-tabs.css'

const CONTROLS = '.live-preview-toolbar-controls'
/** The pane the device is drawn in — what it is fitted to. */
const PANE = '.live-preview-window__main'

/**
 * Live Preview's device tabs (Jason, 2026-11-12): Mobile, Tablet, Desktop and Responsive along the
 * top of the preview, opening on Desktop — in place of Payload's breakpoint dropdown, which hid
 * the choice behind a click and always opened on Responsive.
 *
 * Payload's preview toolbar has no slot, so this is a `ui` field on the page form (inside Payload's
 * Live Preview provider, whose `breakpoint` it reads and sets) that draws nothing where it sits and
 * PORTALS its buttons to the start of the toolbar's controls, found again whenever the preview is
 * opened. `device-tabs.css` hides Payload's dropdown; its width, height, zoom and open-in-a-new-tab
 * stay.
 *
 * A group of toggle buttons (`aria-pressed`), not ARIA tabs: they choose a size for the one
 * preview beside them, and have no panels of their own to own.
 *
 * FITTED TO THE PANE (Jason, 2026-11-12): a device wider than the pane — Desktop, usually Tablet —
 * is shrunk until it shows whole (`fitZoom`), on opening, on every tab, and as the pane is resized.
 * NOT with Payload's own zoom, which keeps the device box at its size and lays the page out WIDER
 * inside it: the fit is a CSS `zoom` on the device frame (`--dd2-preview-fit`, `device-tabs.css`),
 * so the page is laid out at the device's width and the whole box drawn smaller. Payload's zoom
 * control still works; set away from 100% it takes over and the fit steps aside.
 */
export const DeviceTabs = () => {
  const { breakpoint, setBreakpoint, isLivePreviewing, zoom } = useLivePreviewContext()
  const chosen = useRef(false)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const fit = useCallback(
    (device: string) => {
      const pane = document.querySelector<HTMLElement>(PANE)
      if (!pane) return
      // Payload's own zoom, chosen by the person, wins: no fitting on top of it.
      const scale = zoom === 1 ? fitZoom(pane.clientWidth, deviceWidth(device)) : 1
      pane.style.setProperty('--dd2-preview-fit', String(scale))
    },
    [zoom],
  )

  // Fit as the device changes, and as the pane is resized.
  useEffect(() => {
    if (!isLivePreviewing) return
    const pane = document.querySelector<HTMLElement>(PANE)
    fit(breakpoint)
    if (!pane) return
    const watch = new ResizeObserver(() => fit(breakpoint))
    watch.observe(pane)
    return () => watch.disconnect()
  }, [breakpoint, fit, isLivePreviewing, host])

  // Open on Desktop: Payload starts every preview on Responsive and has no setting for it.
  useEffect(() => {
    const next = firstDevice(breakpoint, chosen.current)
    chosen.current = true
    if (next) setBreakpoint(next)
    // Once, as the form opens; after that the person's choice stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A home at the start of the toolbar's controls, made again when the preview reopens.
  useEffect(() => {
    if (!isLivePreviewing) return
    let made: HTMLElement | null = null
    const attach = () => {
      const controls = document.querySelector<HTMLElement>(CONTROLS)
      if (!controls || (made && controls.contains(made))) return
      made?.remove()
      made = document.createElement('div')
      made.className = 'device-tabs-host'
      controls.prepend(made)
      setHost(made)
    }
    attach()
    const watch = new MutationObserver(attach)
    watch.observe(document.body, { childList: true, subtree: true })
    return () => {
      watch.disconnect()
      made?.remove()
      setHost(null)
    }
  }, [isLivePreviewing])

  if (!host) return null
  return createPortal(
    <div aria-label="Preview size" className="device-tabs" id="preview-device-tabs" role="group">
      {DEVICE_TABS.map((tab) => (
        <button
          aria-pressed={breakpoint === tab.name}
          className="device-tabs__tab"
          key={tab.name}
          onClick={() => {
            chosen.current = true
            setBreakpoint(tab.name)
            fit(tab.name)
          }}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>,
    host,
  )
}
