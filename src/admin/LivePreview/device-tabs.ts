/**
 * Live Preview's device tabs (Jason, 2026-11-12): Mobile, Tablet, Desktop and Responsive, to click
 * through and see the page at each, opening on Desktop. PURE — the control is `DeviceTabs.tsx`;
 * the sizes are `admin.livePreview.breakpoints` on `pages`.
 *
 * Responsive is Payload's own breakpoint (the preview fills its pane); the other three are ours.
 */

export const PREVIEW_BREAKPOINTS = [
  { label: 'Mobile', name: 'mobile', width: 375, height: 667 },
  { label: 'Tablet', name: 'tablet', width: 768, height: 1024 },
  { label: 'Desktop', name: 'desktop', width: 1280, height: 800 },
] as const

export const DEVICE_TABS: readonly { name: string; label: string }[] = [
  ...PREVIEW_BREAKPOINTS.map(({ name, label }) => ({ name, label })),
  { name: 'responsive', label: 'Responsive' },
]

export const DEFAULT_DEVICE = 'desktop'

/**
 * The device to switch to when the preview first opens, or null to leave it. Payload always
 * opens on Responsive and has no setting for that, so it is moved to Desktop — once: after that
 * the person's own choice stands, Responsive included.
 */
export const firstDevice = (current: string, alreadyChosen: boolean): string | null =>
  !alreadyChosen && current === 'responsive' ? DEFAULT_DEVICE : null

/** A device's width in pixels, or null for Responsive (the preview fills its pane). */
export const deviceWidth = (name: string): number | null =>
  PREVIEW_BREAKPOINTS.find((b) => b.name === name)?.width ?? null

/** Room left at the pane's edges, so the device's border shows. */
const MARGIN = 32

/**
 * The zoom that shows the whole device in the pane (Jason, 2026-11-12: "make desktop fit the
 * pane") — never above 1, so a device that fits is shown at its own size. Rounded DOWN to the
 * percent, so it never overflows by a pixel.
 */
export const fitZoom = (paneWidth: number, width: number | null): number => {
  if (width === null || !(paneWidth > 0)) return 1
  return Math.min(1, Math.floor(((paneWidth - MARGIN) / width) * 100) / 100)
}
