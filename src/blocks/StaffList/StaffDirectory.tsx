'use client'

import { useId, useMemo, useState } from 'react'

import { VisuallyHidden } from '@/components/VisuallyHidden'
import type { StaffListColumns, StaffMember } from '@/content/types'

import { staffShown } from './staff-filter'
import styles from './StaffList.module.css'

/**
 * The list itself, and a name filter once it is long enough to need one (AMS has one). Rendered
 * whole on the server, so every name is there without JavaScript; the filter only hides.
 *
 * EMAIL, NOT A FORM (Jason, 2026-11-13): a mailto link to the work address, shown as "Email"
 * with an icon and named for the person ("Email Jane Smith") — several sit together, so "Email"
 * alone would be ambiguous to a screen reader. Visitor-facing words are props for Phase 7.
 */

/** Below this many people a filter is clutter. */
const FILTER_FROM = 10

export type StaffDirectoryProps = {
  readonly id: string
  readonly staff: readonly StaffMember[]
  /** The most people side by side (Jason, 2026-11-13); fewer when the space is narrow. */
  readonly maxColumns?: StaffListColumns
  readonly filterLabel?: string
  readonly emailLabel?: string
  readonly countLabel?: (shown: number, total: number) => string
  readonly noMatchLabel?: string
}

const MailIcon = () => (
  <svg aria-hidden="true" className={styles.icon} focusable="false" viewBox="0 0 24 24">
    <path
      d="M3 6h18v12H3z M3 6l9 7 9-7"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </svg>
)

export const StaffDirectory = ({
  id,
  staff,
  maxColumns = 3,
  filterLabel = 'Find a staff member',
  emailLabel = 'Email',
  countLabel = (shown, total) =>
    shown === total ? `${total} people` : `${shown} of ${total} people`,
  noMatchLabel = 'Nobody matches that name.',
}: StaffDirectoryProps) => {
  const ids = useId()
  const [filter, setFilter] = useState('')
  const shown = useMemo(() => staffShown(staff, filter), [staff, filter])
  const filterId = `${ids}-filter`
  const countId = `${ids}-count`

  return (
    <div className={styles.directory} id={`${id}-staff`}>
      {staff.length >= FILTER_FROM ? (
        <div className={styles.filter}>
          <label className={styles.filterLabel} htmlFor={filterId}>
            {filterLabel}
          </label>
          <input
            aria-describedby={countId}
            autoComplete="off"
            className={styles.filterInput}
            id={filterId}
            onChange={(event) => setFilter(event.target.value)}
            type="search"
            value={filter}
          />
          <p aria-live="polite" className={styles.count} id={countId}>
            {countLabel(shown.length, staff.length)}
          </p>
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p>{noMatchLabel}</p>
      ) : (
        <ul className={styles.list} data-max-columns={maxColumns}>
          {shown.map((person) => (
            <li className={styles.person} key={person.id}>
              <p className={styles.name}>{person.name}</p>
              {person.title ? <p className={styles.title}>{person.title}</p> : null}
              {person.email ? (
                <a className={styles.email} href={`mailto:${person.email}`}>
                  <MailIcon />
                  {emailLabel}
                  <VisuallyHidden> {person.name}</VisuallyHidden>
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
