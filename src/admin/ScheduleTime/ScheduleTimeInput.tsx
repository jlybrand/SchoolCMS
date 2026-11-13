'use client'

import { useId, type ReactNode } from 'react'

import { joinLocal, splitLocal, stepTimes, timeLabel } from '@/lib/schedule-step'

import styles from './ScheduleTimeInput.module.css'

const TIMES = stepTimes()

/**
 * A scheduled time (2026-11-13): a day box and a Time list in five-minute steps, when the
 * schedule runs (`src/lib/schedule-step.ts`). Replaces `datetime-local`, whose own list offered
 * every minute whatever its `step` said. Native controls — labelled, keyboard-operable; typing
 * "9" in the list jumps to the nine o'clocks.
 *
 * Controlled by a `datetime-local` string, so the dialogs and their checks are unchanged. A time
 * stored between steps (set before the steps) is still listed, so opening it changes nothing.
 */
export const ScheduleTimeInput = ({
  legend,
  value,
  onChange,
  dayId,
  describedBy,
  invalid = false,
  minDay,
  onEnter,
  legendClassName,
  hint,
}: {
  legend: string
  value: string
  onChange: (value: string) => void
  /** The day box's id — what a refusal moves focus to. */
  dayId?: string | undefined
  describedBy?: string | undefined
  invalid?: boolean | undefined
  /** The earliest day offered, "YYYY-MM-DD". */
  minDay?: string | undefined
  onEnter?: (() => void) | undefined
  legendClassName?: string | undefined
  /** Said under the legend — give it an id and pass that in `describedBy`. */
  hint?: ReactNode
}) => {
  const ids = useId()
  const dayInputId = dayId ?? `${ids}-day`
  const timeId = `${ids}-time`
  const { day, time } = splitLocal(value)
  const times = time !== '' && !TIMES.includes(time) ? [...TIMES, time].sort() : TIMES

  return (
    <fieldset className={styles.field}>
      <legend className={[styles.legend, legendClassName].filter(Boolean).join(' ')}>
        {legend}
      </legend>
      {hint}
      <div className={styles.row}>
        <div className={styles.part}>
          <label className={styles.label} htmlFor={dayInputId}>
            Day
          </label>
          <input
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={styles.control}
            id={dayInputId}
            min={minDay}
            onChange={(event) => onChange(joinLocal(event.target.value, time))}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !onEnter) return
              event.preventDefault()
              onEnter()
            }}
            type="date"
            value={day}
          />
        </div>
        <div className={styles.part}>
          <label className={styles.label} htmlFor={timeId}>
            Time
          </label>
          <select
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={styles.control}
            id={timeId}
            onChange={(event) => onChange(joinLocal(day, event.target.value))}
            value={time}
          >
            <option value="">Choose a time</option>
            {times.map((t) => (
              <option key={t} value={t}>
                {timeLabel(t)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </fieldset>
  )
}
