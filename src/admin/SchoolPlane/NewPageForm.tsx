'use client'

import { useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import type { SchoolOption } from './school-data'
import { checkNewPage, explainCreateError } from './school-plane'
import styles from './SchoolPlane.module.css'

type Field = 'title' | 'school'
type Errors = Partial<Record<Field, string>>

/**
 * The new-page form. Plain HTML controls rather than Payload fields: this is not a document
 * form, it creates one, and Payload's `select` fails the axe gate (`payload-select-fails-axe`)
 * — the page type is a radio group with a description under each choice instead.
 *
 * On a problem, every message shows at once beside its field and focus moves to the first, so
 * a keyboard or screen-reader user lands on what to fix (`04` §6: errors specific and in text).
 *
 * The create is a draft through the REST API as the user — the same request Payload's own form
 * makes, through the same access functions and hooks. `applyReviewState` marks it `editing`.
 * The button says what it does; "Send for approval" is the next screen's, once there is
 * something to send.
 */
export const NewPageForm = ({ schools }: { schools: readonly SchoolOption[] }) => {
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

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const check = checkNewPage({
      title: form.get('title'),
      school: form.get('school') ?? undefined,
      schools: schools.map((s) => s.id),
    })

    setFailure(null)
    if (!check.ok) {
      setErrors(check.errors)
      const first = (['title', 'school'] as const).find((f) => check.errors[f])
      if (first) document.getElementById(fieldId(first))?.focus()
      return
    }
    setErrors({})
    setBusy(true)

    try {
      const res = await fetch(`${api}/pages?draft=true&depth=0`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: check.title,
          // A school's page is a page (Jason, 2026-11-04): no kind to choose.
          pageType: 'standard',
          tenant: check.school,
          _status: 'draft',
        }),
      })
      const body: unknown = await res.json().catch(() => null)
      const created = (body as { doc?: { id?: unknown } } | null)?.doc?.id
      if (res.ok && created !== undefined) {
        router.push(`/admin/collections/pages/${String(created)}`)
        return
      }
      setFailure(explainCreateError(body))
    } catch {
      setFailure(explainCreateError(null))
    }
    setBusy(false)
  }

  // After React renders the message, so it is what focus lands on. (A next-frame focus raced
  // the commit under load.)
  useEffect(() => {
    if (failure) failureRef.current?.focus()
  }, [failure])

  const invalid = (field: Field) =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': errorId(field) } : {}

  return (
    <form className={styles.form} noValidate onSubmit={(e) => void onSubmit(e)}>
      {failure ? (
        <p className={styles.failure} ref={failureRef} role="alert" tabIndex={-1}>
          {failure}
        </p>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId('title')}>
          What is this page called?
        </label>
        <p className={styles.hint} id={`${id}-title-hint`}>
          This is the heading people see at the top of the page.
        </p>
        <input
          autoComplete="off"
          className={styles.input}
          id={fieldId('title')}
          name="title"
          type="text"
          {...invalid('title')}
          aria-describedby={
            errors.title ? `${errorId('title')} ${id}-title-hint` : `${id}-title-hint`
          }
        />
        {errors.title ? (
          <p className={styles.error} id={errorId('title')}>
            {errors.title}
          </p>
        ) : null}
      </div>

      {schools.length > 1 ? (
        <fieldset className={styles.field} {...invalid('school')}>
          <legend className={styles.label}>Which school is this page for?</legend>
          {errors.school ? (
            <p className={styles.error} id={errorId('school')}>
              {errors.school}
            </p>
          ) : null}
          {schools.map((school, index) => (
            <div className={styles.choice} key={school.id}>
              <input
                id={index === 0 ? fieldId('school') : `${id}-school-${school.id}`}
                name="school"
                type="radio"
                value={String(school.id)}
              />
              <label htmlFor={index === 0 ? fieldId('school') : `${id}-school-${school.id}`}>
                <span className={styles.choiceLabel}>{school.name}</span>
              </label>
            </div>
          ))}
        </fieldset>
      ) : errors.school ? (
        // No school to choose: say so where the choice would have been.
        <p className={styles.error} id={fieldId('school')} tabIndex={-1}>
          {errors.school}
        </p>
      ) : null}

      <button className={styles.button} disabled={busy} type="submit">
        {busy ? 'Creating the page…' : 'Create the page'}
      </button>
    </form>
  )
}
