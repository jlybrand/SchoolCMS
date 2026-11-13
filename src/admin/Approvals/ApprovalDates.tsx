'use client'

import { useId } from 'react'

import { ScheduleTimeInput } from '@/admin/ScheduleTime/ScheduleTimeInput'
import type { PostDateField } from '@/lib/post-dates'

import styles from './Approvals.module.css'

export type DateInputs = Record<PostDateField, string>

export const NO_DATES: DateInputs = { publishAt: '', expiresAt: '', featuredUntil: '' }

const FIELDS: readonly { name: PostDateField; label: string; hint: string }[] = [
  { name: 'publishAt', label: 'Start', hint: 'Goes live at this time instead of now.' },
  { name: 'expiresAt', label: 'Expires', hint: 'Taken off the website at this time.' },
  { name: 'featuredUntil', label: 'Featured until', hint: 'Listed first in news until then.' },
]

/** A `datetime-local` value as an instant — the browser's clock is the district's. */
export const inputToIso = (value: string): string | null => {
  if (value === '') return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? value : at.toISOString()
}

/**
 * "Set dates" on an announcement in the queue (Jason, 2026-11-04): optional, closed by default,
 * so Approve stays one click. A future Start turns Approve into "Approve and schedule". Plain
 * `datetime-local` inputs — native, labelled, keyboard-operable — rather than Payload's date
 * picker — a day and a five-minute Time list since 2026-11-13 (`ScheduleTimeInput`), which this view does not run inside a form for.
 */
export const ApprovalDates = ({
  values,
  errors,
  onChange,
}: {
  values: DateInputs
  errors: Partial<Record<PostDateField, string>>
  onChange: (values: DateInputs) => void
}) => {
  const id = useId()
  const open = Object.values(values).some((v) => v !== '') || Object.keys(errors).length > 0

  return (
    <details className={styles.dates} open={open || undefined}>
      <summary className={styles.datesSummary}>Set dates</summary>
      <div className={styles.datesFields}>
        {FIELDS.map((field) => {
          const inputId = `${id}-${field.name}`
          const hintId = `${inputId}-hint`
          const errorId = `${inputId}-error`
          const error = errors[field.name]
          return (
            <div className={styles.dateField} data-field={field.name} key={field.name}>
              {/* A day and a Time list in five-minute steps, when the schedule runs. */}
              <ScheduleTimeInput
                describedBy={error ? `${errorId} ${hintId}` : hintId}
                hint={
                  <span className={styles.dateHint} id={hintId}>
                    {field.hint}
                  </span>
                }
                invalid={Boolean(error)}
                legend={field.label}
                legendClassName={styles.noteLabel}
                onChange={(next) => onChange({ ...values, [field.name]: next })}
                value={values[field.name]}
              />
              {error ? (
                <p className={styles.noteError} id={errorId}>
                  {error}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
    </details>
  )
}
