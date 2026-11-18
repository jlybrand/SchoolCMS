'use client'

import { usePreferences } from '@payloadcms/ui'
import { PREFERENCE_KEYS } from 'payload/shared'
import type { ReactNode, SyntheticEvent } from 'react'

import styles from './Nav.module.css'

/**
 * The "Everything else" fold itself: a native `<details>`, not Payload's `NavGroup`, whose toggle
 * button carries no `aria-expanded` — a screen reader could not tell open from closed. `<details>`
 * says so with no script and is keyboard operable. Its open state is saved where Payload's
 * `NavGroup` saves its own: the `nav` preference, under the fold's label — `merge` deep-merges it
 * into the groups already there.
 */
export const EverythingElseFold = ({
  label,
  open,
  children,
}: {
  label: string
  open: boolean
  children: ReactNode
}) => {
  const { setPreference } = usePreferences()
  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) =>
    setPreference(
      PREFERENCE_KEYS.NAV,
      { groups: { [label]: { open: event.currentTarget.open } } },
      true,
    )
  return (
    <details
      className={styles.fold}
      id="nav-everything-else"
      onToggle={(e) => void onToggle(e)}
      open={open}
    >
      <summary className={styles.foldSummary}>{label}</summary>
      {children}
    </details>
  )
}
