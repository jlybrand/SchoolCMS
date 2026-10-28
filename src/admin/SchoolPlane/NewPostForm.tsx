'use client'

import { useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import type { BoardOption } from './school-data'
import { checkNewPost, explainPostCreateError } from './school-plane'
import styles from './SchoolPlane.module.css'

type Field = 'title' | 'board'
type Errors = Partial<Record<Field, string>>

/**
 * The new-announcement form: a headline, and the board when there is a choice (Jason,
 * 2026-10-28: one board per post). The school follows from the board. The same shape
 * and error handling as `NewPageForm`, less the page type — see that file for why these are
 * plain HTML controls.
 *
 * The create is a draft through REST as the user, so the access functions and hooks decide;
 * then the announcement's own form opens, where the words are written and sent.
 */
export const NewPostForm = ({ boards }: { boards: readonly BoardOption[] }) => {
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
    const check = checkNewPost({
      title: form.get('title'),
      board: form.get('board') ?? undefined,
      boards,
    })

    setFailure(null)
    if (!check.ok) {
      setErrors(check.errors)
      const first = (['title', 'board'] as const).find((f) => check.errors[f])
      if (first) document.getElementById(fieldId(first))?.focus()
      return
    }
    setErrors({})
    setBusy(true)

    try {
      const res = await fetch(`${api}/posts?draft=true&depth=0`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: check.title,
          tenant: check.school,
          board: check.board,
          _status: 'draft',
        }),
      })
      const body: unknown = await res.json().catch(() => null)
      const created = (body as { doc?: { id?: unknown } } | null)?.doc?.id
      if (res.ok && created !== undefined) {
        router.push(`/admin/collections/posts/${String(created)}`)
        return
      }
      setFailure(explainPostCreateError(body))
    } catch {
      setFailure(explainPostCreateError(null))
    }
    setBusy(false)
  }

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
          What is the headline?
        </label>
        <p className={styles.hint} id={`${id}-title-hint`}>
          A few words that say what the news is. You write the announcement on the next screen.
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

      {boards.length > 1 ? (
        <fieldset className={styles.field} {...invalid('board')}>
          <legend className={styles.label}>Which board is this for?</legend>
          {errors.board ? (
            <p className={styles.error} id={errorId('board')}>
              {errors.board}
            </p>
          ) : null}
          {boards.map((board, index) => (
            <div className={styles.choice} key={board.id}>
              <input
                id={index === 0 ? fieldId('board') : `${id}-board-${board.id}`}
                name="board"
                type="radio"
                value={String(board.id)}
              />
              <label htmlFor={index === 0 ? fieldId('board') : `${id}-board-${board.id}`}>
                <span className={styles.choiceLabel}>{board.label}</span>
              </label>
            </div>
          ))}
        </fieldset>
      ) : errors.board ? (
        // No board to choose: say so where the choice would have been.
        <p className={styles.error} id={fieldId('board')} tabIndex={-1}>
          {errors.board}
        </p>
      ) : null}

      <button className={styles.button} disabled={busy} type="submit">
        {busy ? 'Starting the announcement…' : 'Write the announcement'}
      </button>
    </form>
  )
}
