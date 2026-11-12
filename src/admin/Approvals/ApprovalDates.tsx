'use client'

import { useId } from 'react'

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
 * picker, which this view does not run inside a form for.
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
            <div className={styles.dateField} key={field.name}>
              <label className={styles.noteLabel} htmlFor={inputId}>
                {field.label}
              </label>
              <span className={styles.dateHint} id={hintId}>
                {field.hint}
              </span>
              <input
                aria-describedby={error ? `${errorId} ${hintId}` : hintId}
                aria-invalid={error ? true : undefined}
                className={styles.dateInput}
                data-field={field.name}
                id={inputId}
                onChange={(e) => onChange({ ...values, [field.name]: e.target.value })}
                type="datetime-local"
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
