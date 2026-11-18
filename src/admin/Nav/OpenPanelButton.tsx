'use client'

import { OPEN_PANEL_EVENT, type PanelKind } from './action-menu'

/**
 * "Change site" on a site's pages, "Choose a folder" in the file library: opens the same panel
 * that slides out of the menu (`ActionMenuLinks`), so there is one list and one way to choose.
 * Focus goes back here when it shuts.
 */
export const OpenPanelButton = ({
  kind,
  className,
  id,
  children,
}: {
  kind: PanelKind
  className?: string | undefined
  id?: string
  children: string
}) => (
  // No `aria-controls`: the panel exists only while open, and with no `aria-expanded` here a
  // reference to it while shut is invalid ARIA. The menu buttons, which do say expanded, carry it.
  <button
    className={className}
    id={id}
    onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: kind }))}
    type="button"
  >
    {children}
  </button>
)
