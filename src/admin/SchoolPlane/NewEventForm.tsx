'use client'

import { useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import type { CalendarOption, ImportedCalendar } from './school-data'
import { checkNewEvent, explainEventCreateError } from './school-plane'
import styles from './SchoolPlane.module.css'

type Field = 'title' | 'date' | 'time' | 'calendar'
type Errors = Partial<Record<Field, string>>

/**
 * The new-event form (Jason, 2026-11-11): its name, its day, the time it starts (none for all
 * day), and the calendar when there is a choice. The same shape and error handling as
 * `NewPostForm` — plain HTML controls, every problem reported at once, focus on the first.
 *
 * The browser's own date and time pickers: accessible, localised, and keyboard-operable without
 * a widget of ours. The day and time are read as the district's (`checkNewEvent`).
 *
 * The create is a draft through REST as the user, so the access functions and hooks decide;
 * then the event's own form opens for the end, the place, repeats and notes, and "Send for
 * approval".
 */
export const NewEventForm = ({
  calendars,
  imported = [],
}: {
  calendars: readonly CalendarOption[]
  /**
   * The school's imported calendars (Jason, 2026-11-18): not choices — their events come from
   * their address — but named, with where they come from, so none seems to be missing.
   */
  imported?: readonly ImportedCalendar[]
}) => {
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const router = useRouter()
  const id = useId()
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const failureRef = useRef<HTMLParagraphElement>(null)

  const fieldId = (field: Field) => `${id}-${field}`
  const errorId = (field: Field) => `${id}-${field}-error`
  const hintId = (field: Field) => `${id}-${field}-hint`

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const check = checkNewEvent({
      title: form.get('title'),
      date: form.get('date'),
      time: form.get('time') ?? '',
      calendar: form.get('calendar') ?? undefined,
      calendars,
    })

    setFailure(null)
    if (!check.ok) {
      setErrors(check.errors)
      const first = (['title', 'date', 'time', 'calendar'] as const).find((f) => check.errors[f])
      if (first) document.getElementById(fieldId(first))?.focus()
      return
    }
    setErrors({})
    setBusy(true)

    try {
      const res = await fetch(`${api}/events?draft=true&depth=0`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: check.title,
          tenant: check.school,
          calendar: check.calendar,
          start: check.start,
          allDay: check.allDay,
          _status: 'draft',
        }),
      })
      const body: unknown = await res.json().catch(() => null)
      const created = (body as { doc?: { id?: unknown } } | null)?.doc?.id
      if (res.ok && created !== undefined) {
        router.push(`/admin/collections/events/${String(created)}`)
        return
      }
      setFailure(explainEventCreateError(body))
    } catch {
      setFailure(explainEventCreateError(null))
    }
    setBusy(false)
  }

  useEffect(() => {
    if (failure) failureRef.current?.focus()
  }, [failure])

  /** `aria-describedby` for a field: its error first, then its hint. */
  const described = (field: Field, hint: boolean) => {
    const ids = [errors[field] ? errorId(field) : null, hint ? hintId(field) : null].filter(Boolean)
    return ids.length === 0 ? {} : { 'aria-describedby': ids.join(' ') }
  }
  const invalid = (field: Field) => (errors[field] ? { 'aria-invalid': true } : {})
  const error = (field: Field) =>
    errors[field] ? (
      <p className={styles.error} id={errorId(field)}>
        {errors[field]}
      </p>
    ) : null

  return (
    <form className={styles.form} noValidate onSubmit={(e) => void onSubmit(e)}>
      {failure ? (
        <p className={styles.failure} ref={failureRef} role="alert" tabIndex={-1}>
          {failure}
        </p>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId('title')}>
          What is the event called?
        </label>
        <p className={styles.hint} id={hintId('title')}>
          As it should appear on the calendar, like “Book fair”.
        </p>
        <input
          autoComplete="off"
          className={styles.input}
          id={fieldId('title')}
          name="title"
          type="text"
          {...invalid('title')}
          {...described('title', true)}
        />
        {error('title')}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId('date')}>
          What day is it?
        </label>
        <input
          className={styles.input}
          id={fieldId('date')}
          name="date"
          type="date"
          {...invalid('date')}
          {...described('date', false)}
        />
        {error('date')}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId('time')}>
          What time does it start?
        </label>
        <p className={styles.hint} id={hintId('time')}>
          Leave this empty if it lasts all day. You can add an end time, a place and notes on the
          next screen.
        </p>
        <input
          className={styles.input}
          id={fieldId('time')}
          name="time"
          type="time"
          {...invalid('time')}
          {...described('time', true)}
        />
        {error('time')}
      </div>

      {calendars.length > 1 ? (
        <fieldset
          className={styles.field}
          {...invalid('calendar')}
          {...described('calendar', false)}
        >
          <legend className={styles.label}>Which calendar is it for?</legend>
          {error('calendar')}
          {calendars.map((calendar, index) => {
            const inputId = index === 0 ? fieldId('calendar') : `${id}-calendar-${calendar.id}`
            return (
              <div className={styles.choice} key={calendar.id}>
                <input id={inputId} name="calendar" type="radio" value={String(calendar.id)} />
                <label htmlFor={inputId}>
                  <span className={styles.choiceLabel}>{calendar.label}</span>
                </label>
              </div>
            )
          })}
        </fieldset>
      ) : errors.calendar ? (
        // No calendar to choose: say so where the choice would have been.
        <p className={styles.error} id={fieldId('calendar')} tabIndex={-1}>
          {errors.calendar}
        </p>
      ) : null}

      {imported.length > 0 ? (
        <ul className={styles.feedNotes} id={`${id}-imported`}>
          {imported.map((calendar) => (
            <li key={calendar.id}>
              <span className={styles.choiceLabel}>{calendar.label}</span>: {calendar.note}
            </li>
          ))}
        </ul>
      ) : null}

      <button className={styles.button} disabled={busy} type="submit">
        {busy ? 'Starting the event…' : 'Add the details'}
      </button>
    </form>
  )
}
