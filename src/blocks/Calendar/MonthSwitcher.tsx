'use client'

import { useState, type ReactNode } from 'react'

import { Heading, type HeadingLevel } from '@/components/Heading'

import styles from './Calendar.module.css'

/**
 * The grid's month, one at a time, with previous and next (Jason, 2026-11-11). The months are
 * server-rendered and handed in as `panels`; this only chooses which to show.
 *
 * The month's name is a heading inside a polite live region, so a screen-reader user hears
 * "December 2026" after pressing Next — and the table names itself after the same heading
 * (`labelId`), so the two cannot disagree.
 */
export type MonthSwitcherProps = {
  readonly labels: readonly string[]
  readonly panels: readonly ReactNode[]
  readonly labelId: string
  readonly level: HeadingLevel
}

export const MonthSwitcher = ({ labels, panels, labelId, level }: MonthSwitcherProps) => {
  const [index, setIndex] = useState(0)
  const last = labels.length - 1
  return (
    <div className={styles.months}>
      <div className={styles.monthNav}>
        <button
          className={styles.navButton}
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          type="button"
        >
          Previous month
        </button>
        <div aria-live="polite" className={styles.monthLabel}>
          <Heading id={labelId} level={level} size="lg">
            {labels[index]}
          </Heading>
        </div>
        <button
          className={styles.navButton}
          disabled={index === last}
          onClick={() => setIndex((i) => Math.min(last, i + 1))}
          type="button"
        >
          Next month
        </button>
      </div>
      {panels[index]}
    </div>
  )
}
