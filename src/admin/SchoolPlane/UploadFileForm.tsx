'use client'

import { useConfig } from '@payloadcms/ui'
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'

import { kindOf } from '@/lib/resources'

import type { SchoolOption } from './school-data'
import styles from './SchoolPlane.module.css'
import {
  checkUpload,
  explainUploadError,
  titleFromFilename,
  type FolderOption,
  type UploadField,
} from './upload-file'

type Errors = Partial<Record<UploadField, string>>

const FIELD_ORDER: readonly UploadField[] = [
  'school',
  'file',
  'title',
  'alt',
  'remediationStatus',
  'folder',
]

/** The library's accepted types, for the file picker — images and documents only. */
const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx'

/**
 * The school's upload (Jason, 2026-11-13). It asks only what the chosen file's KIND needs: alt
 * text, or "decorative", for an image; the accessibility answer for a document. The rules and
 * the words are `checkUpload`'s, the server's own (`resourceProblems`). The file goes to
 * `POST /api/resources` as multipart, with the rest as `_payload`.
 *
 * Built, then locked with Playwright + axe (CLAUDE.md's exception for admin views):
 * `tests/e2e/school-upload.spec.ts`.
 */
export const UploadFileForm = ({
  schools,
  folders,
}: {
  schools: readonly SchoolOption[]
  folders: readonly FolderOption[]
}) => {
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
  const [title, setTitle] = useState('')
  const [school, setSchool] = useState(schools.length === 1 ? String(schools[0]!.id) : '')
  const [decorative, setDecorative] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const kind = file ? kindOf(file.type) : null
  const schoolFolders = folders.filter((f) => String(f.tenant) === school)

  const fieldId = (field: string) => `${id}-${field}`
  const errorId = (field: UploadField) => `${id}-${field}-error`
  const hintId = (field: string) => `${id}-${field}-hint`

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null
    setFile(chosen)
    setDone(null)
    // A starting title from the file's name, unless one has been typed.
    if (chosen && title.trim() === '') setTitle(titleFromFilename(chosen.name))
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const check = checkUpload({
      file: file ? { name: file.name, type: file.type, size: file.size } : null,
      title,
      alt: form.get('alt') ?? undefined,
      isDecorative: decorative,
      remediationStatus: form.get('remediationStatus') ?? undefined,
      description: form.get('description') ?? undefined,
      tagsText: form.get('tagsText') ?? undefined,
      folder: form.get('folder') ?? undefined,
      school,
      schools: schools.map((s) => s.id),
      folders,
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
      const res = await fetch(`${api}/resources?depth=0`, {
        method: 'POST',
        credentials: 'include',
        body,
      })
      const json: unknown = await res.json().catch(() => null)
      if (res.ok) {
        setDone(`Uploaded “${String(check.data.title)}” to your school’s library.`)
        formRef.current?.reset()
        setFile(null)
        setTitle('')
        setDecorative(false)
      } else {
        const explained = explainUploadError(json)
        setErrors(explained.fields)
        setFailure(explained.failure)
        const first = FIELD_ORDER.find((f) => explained.fields[f])
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

  /** `aria-describedby`: the error first, then the hint. */
  const described = (field: UploadField, hint: boolean) => {
    const ids = [errors[field] ? errorId(field) : null, hint ? hintId(field) : null].filter(Boolean)
    return ids.length === 0 ? {} : { 'aria-describedby': ids.join(' ') }
  }
  const invalid = (field: UploadField) => (errors[field] ? { 'aria-invalid': true } : {})
  const error = (field: UploadField) =>
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
          {done} You can upload another.
        </p>
      ) : null}

      {schools.length > 1 ? (
        <fieldset className={styles.field} {...invalid('school')}>
          <legend className={styles.label}>Which school is this file for?</legend>
          {error('school')}
          {schools.map((s) => (
            <div className={styles.choice} key={String(s.id)}>
              <input
                checked={school === String(s.id)}
                id={s === schools[0] ? fieldId('school') : `${fieldId('school')}-${String(s.id)}`}
                name="school"
                onChange={() => setSchool(String(s.id))}
                type="radio"
                value={String(s.id)}
              />
              <label
                className={styles.choiceLabel}
                htmlFor={
                  s === schools[0] ? fieldId('school') : `${fieldId('school')}-${String(s.id)}`
                }
              >
                {s.name}
              </label>
            </div>
          ))}
        </fieldset>
      ) : schools.length === 0 ? (
        <p className={styles.error} id={fieldId('school')} tabIndex={-1}>
          {errors.school ??
            'Your account is not linked to a school yet. Ask the district web team to add it.'}
        </p>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId('file')}>
          The file
        </label>
        <p className={styles.hint} id={hintId('file')}>
          An image (JPEG, PNG, GIF, WebP) or a document (PDF, Word, Excel, PowerPoint), up to 25 MB.
        </p>
        {error('file')}
        <input
          accept={ACCEPT}
          className={styles.input}
          id={fieldId('file')}
          name="file"
          onChange={onFile}
          type="file"
          {...invalid('file')}
          {...described('file', true)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId('title')}>
          Title
        </label>
        <p className={styles.hint} id={hintId('title')}>
          What people will see, like “Lunch menu, November”.
        </p>
        {error('title')}
        <input
          autoComplete="off"
          className={styles.input}
          id={fieldId('title')}
          name="title"
          onChange={(e) => setTitle(e.target.value)}
          type="text"
          value={title}
          {...invalid('title')}
          {...described('title', true)}
        />
      </div>

      {kind === 'image' ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId('alt')}>
            Describe the image
          </label>
          <p className={styles.hint} id={hintId('alt')}>
            What someone who can’t see it needs to know, like “Students showing their volcano at the
            science fair”.
          </p>
          {error('alt')}
          <textarea
            className={styles.input}
            disabled={decorative}
            id={fieldId('alt')}
            name="alt"
            rows={3}
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
      ) : null}

      {kind === 'document' ? (
        <fieldset className={styles.field} {...invalid('remediationStatus')}>
          <legend className={styles.label}>
            Has this document been checked for accessibility?
          </legend>
          {error('remediationStatus')}
          {(
            [
              ['attested', 'Yes — checked and fixed'],
              ['not-attested', 'No — not checked yet'],
              ['not-applicable', 'Not needed — it’s a form to print, or similar'],
            ] as const
          ).map(([value, label], index) => (
            <div className={styles.choice} key={value}>
              <input
                id={
                  index === 0
                    ? fieldId('remediationStatus')
                    : `${fieldId('remediationStatus')}-${value}`
                }
                name="remediationStatus"
                type="radio"
                value={value}
              />
              <label
                className={styles.choiceLabel}
                htmlFor={
                  index === 0
                    ? fieldId('remediationStatus')
                    : `${fieldId('remediationStatus')}-${value}`
                }
              >
                {label}
              </label>
            </div>
          ))}
        </fieldset>
      ) : null}

      {schoolFolders.length > 0 ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId('folder')}>
            Folder
          </label>
          {error('folder')}
          <select
            className={styles.input}
            defaultValue=""
            id={fieldId('folder')}
            name="folder"
            {...invalid('folder')}
            {...described('folder', false)}
          >
            <option value="">The top of the library</option>
            {schoolFolders.map((f) => (
              <option key={String(f.id)} value={String(f.id)}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId('description')}>
          Description
        </label>
        <textarea
          className={styles.input}
          id={fieldId('description')}
          name="description"
          rows={3}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId('tagsText')}>
          Tags
        </label>
        <p className={styles.hint} id={hintId('tagsText')}>
          Separate tags with commas, for example “forms, enrollment”.
        </p>
        <input
          autoComplete="off"
          aria-describedby={hintId('tagsText')}
          className={styles.input}
          id={fieldId('tagsText')}
          name="tagsText"
          type="text"
        />
      </div>

      <button className={styles.button} disabled={busy} type="submit">
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  )
}
