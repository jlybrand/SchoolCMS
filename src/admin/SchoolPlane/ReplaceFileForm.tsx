'use client'

import { useConfig } from '@payloadcms/ui'
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'

import { fileSizeLabel, fileTypeLabel } from '@/content/document-item'
import { mimeTypesFor } from '@/lib/resources'

import { checkReplace, type ReplaceField } from './replace-file'
import type { MyFile } from './school-data'
import styles from './SchoolPlane.module.css'
import { explainUploadError } from './upload-file'

type Errors = Partial<Record<ReplaceField, string>>
const FIELD_ORDER: readonly ReplaceField[] = ['file', 'alt']

/**
 * The form of "Replace a file" (Jason, 2026-11-16). Shows the file now; takes a new one of the
 * SAME KIND only (the picker offers only those types, and `checkReplace` and the server refuse
 * any other). For an image the description is asked again, PREFILLED with the current one —
 * sending it is the confirmation that it still fits. A document asks nothing more, and says the
 * new one will be marked not checked until someone checks it.
 *
 * `PATCH /api/resources/<id>` as multipart — the same entry, a new file. No approval.
 *
 * Built, then locked with Playwright + axe (CLAUDE.md's exception for admin views):
 * `tests/e2e/replace-file.spec.ts`.
 */
export const ReplaceFileForm = ({ file: current }: { file: MyFile }) => {
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const id = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const failureRef = useRef<HTMLParagraphElement>(null)
  const doneRef = useRef<HTMLParagraphElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [alt, setAlt] = useState(current.alt)
  const [decorative, setDecorative] = useState(current.isDecorative)
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const fieldId = (field: string) => `${id}-${field}`
  const errorId = (field: ReplaceField) => `${id}-${field}-error`
  const hintId = (field: string) => `${id}-${field}-hint`
  const isImage = current.kind === 'image'
  const size = fileSizeLabel(current.filesize)

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null)
    setDone(null)
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const check = checkReplace({
      original: { kind: current.kind, mimeType: current.mimeType },
      file: file ? { name: file.name, type: file.type, size: file.size } : null,
      alt,
      isDecorative: decorative,
    })
    setFailure(null)
    setDone(null)
    if (!check.ok) {
      setErrors(check.errors)
      const first = FIELD_ORDER.find((f) => check.errors[f])
      if (first) document.getElementById(fieldId(first))?.focus()
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', file as File)
      body.append('_payload', JSON.stringify(check.data))
      const res = await fetch(`${api}/resources/${String(current.id)}?depth=0`, {
        method: 'PATCH',
        credentials: 'include',
        body,
      })
      const json: unknown = await res.json().catch(() => null)
      if (res.ok) {
        setDone(`Replaced “${current.title}”. Pages using it show the new file.`)
        formRef.current?.reset()
        setFile(null)
      } else {
        const explained = explainUploadError(json)
        setErrors(explained.fields as Errors)
        setFailure(explained.failure)
        const first = FIELD_ORDER.find((f) => (explained.fields as Errors)[f])
        if (first) document.getElementById(fieldId(first))?.focus()
      }
    } catch {
      setFailure(explainUploadError(null).failure)
    }
    setBusy(false)
  }

  useEffect(() => {
    if (failure) failureRef.current?.focus()
  }, [failure])
  useEffect(() => {
    if (done) doneRef.current?.focus()
  }, [done])

  const described = (field: ReplaceField, hint: boolean) => {
    const ids = [errors[field] ? errorId(field) : null, hint ? hintId(field) : null].filter(Boolean)
    return ids.length === 0 ? {} : { 'aria-describedby': ids.join(' ') }
  }
  const invalid = (field: ReplaceField) => (errors[field] ? { 'aria-invalid': true } : {})
  const error = (field: ReplaceField) =>
    errors[field] ? (
      <p className={styles.error} id={errorId(field)}>
        {errors[field]}
      </p>
    ) : null

  return (
    <form className={styles.form} noValidate onSubmit={(e) => void onSubmit(e)} ref={formRef}>
      {failure ? (
        <p className={styles.failure} ref={failureRef} role="alert" tabIndex={-1}>
          {failure}
        </p>
      ) : null}
      {done ? (
        <p className={styles.done} ref={doneRef} role="status" tabIndex={-1}>
          {done}
        </p>
      ) : null}

      <div className={styles.field}>
        <p className={styles.label}>Now</p>
        {isImage && current.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- the library's own thumbnail
          <img alt="" className={styles.preview} src={current.thumbnail} />
        ) : null}
        <p className={styles.hint}>
          {[isImage ? 'Image' : fileTypeLabel(current.mimeType), size].filter(Boolean).join(', ')}
          {current.url ? (
            <>
              {' · '}
              <a href={current.url}>Open it</a>
            </>
          ) : null}
        </p>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId('file')}>
          The new file
        </label>
        <p className={styles.hint} id={hintId('file')}>
          {isImage
            ? 'An image (JPEG, PNG, GIF, WebP), up to 25 MB.'
            : 'A document (PDF, Word, Excel, PowerPoint), up to 25 MB.'}
        </p>
        {error('file')}
        <input
          accept={mimeTypesFor(current.kind).join(',')}
          className={styles.input}
          id={fieldId('file')}
          name="file"
          onChange={onFile}
          type="file"
          {...invalid('file')}
          {...described('file', true)}
        />
      </div>

      {isImage ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId('alt')}>
            Describe the new image
          </label>
          <p className={styles.hint} id={hintId('alt')}>
            Check this still fits the new image, and change it if it doesn’t.
          </p>
          {error('alt')}
          <textarea
            className={styles.input}
            disabled={decorative}
            id={fieldId('alt')}
            name="alt"
            onChange={(e) => setAlt(e.target.value)}
            rows={3}
            value={alt}
            {...invalid('alt')}
            {...described('alt', true)}
          />
          <div className={styles.choice}>
            <input
              checked={decorative}
              id={fieldId('decorative')}
              name="isDecorative"
              onChange={(e) => setDecorative(e.target.checked)}
              type="checkbox"
            />
            <label htmlFor={fieldId('decorative')}>
              <span className={styles.choiceLabel}>This image is decorative</span>
              <span className={styles.choiceDescription}>
                It adds nothing a description would — a border or a background pattern.
              </span>
            </label>
          </div>
        </div>
      ) : (
        <p className={styles.hint}>
          The new document will be marked not checked for accessibility until someone checks it.
        </p>
      )}

      <button className={styles.button} disabled={busy} type="submit">
        {busy ? 'Replacing…' : 'Replace'}
      </button>
    </form>
  )
}
