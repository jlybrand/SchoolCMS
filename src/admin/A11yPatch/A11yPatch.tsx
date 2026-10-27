'use client'

import { useEffect, type ReactNode } from 'react'

import { repairAdminA11y } from './repairs'

/**
 * Runs `repairAdminA11y` over the whole admin, on every screen, for every role
 * (`admin.components.providers`). See `repairs.ts` for what it repairs and why it is a stopgap.
 *
 * Payload renders and re-renders after hydration — drawers, list pages, the rich-text toolbar —
 * so one pass on load is not enough. A MutationObserver re-runs it, at most once per frame.
 * It watches child lists only, never attributes, so its own repairs cannot retrigger it.
 */
export const A11yPatch = ({ children }: { children?: ReactNode }) => {
  useEffect(() => {
    let frame = 0
    const run = () => {
      frame = 0
      repairAdminA11y(document)
    }
    run()
    const observer = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(run)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [])

  return <>{children}</>
}
