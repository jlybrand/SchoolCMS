import { kindOf, resourceProblems } from '@/lib/resources'

/**
 * "Upload a file" on the school plane (Jason, 2026-11-13) — the form's rules. PURE.
 *
 * It asks only what a file can't go in without, and only what its KIND needs: alt text (or
 * decorative) for an image, the accessibility answer for a document. The words are the
 * library's own (`resourceProblems`), so the form and the server never disagree. A school's own
 * folders only. No approval: a file isn't on the site until an approved page uses it.
 */

/** The largest file the library takes — Payload refuses anything bigger too (`payload.config`). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

type Id = number | string

export type FolderOption = { id: Id; tenant: Id; label: string }

export type UploadInput = {
  file: { name: string; type: string; size: number } | null
  title?: unknown
  alt?: unknown
  isDecorative?: unknown
  remediationStatus?: unknown
  description?: unknown
  tagsText?: unknown
  folder?: unknown
  /** The school chosen in the form, when there was a choice. */
  school?: unknown
  /** The schools the user is assigned to. */
  schools: readonly Id[]
  /** Every folder of the user's schools. */
  folders: readonly FolderOption[]
}

export type UploadField = 'file' | 'title' | 'alt' | 'remediationStatus' | 'school' | 'folder'

export type UploadCheck =
  | { ok: true; school: Id; data: Record<string, unknown> }
  | { ok: false; errors: Partial<Record<UploadField, string>> }

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const NO_SCHOOL = 'Your account is not linked to a school yet. Ask the district web team to add it.'

export const checkUpload = (input: UploadInput): UploadCheck => {
  const errors: Partial<Record<UploadField, string>> = {}

  if (!input.file) errors.file = 'Choose a file to upload.'
  else if (input.file.size > MAX_UPLOAD_BYTES) errors.file = 'That file is too big — 25 MB at most.'

  const title = text(input.title)
  if (title === '') errors.title = 'Give the file a title.'

  let school: Id | undefined
  if (input.schools.length === 0) errors.school = NO_SCHOOL
  else if (input.schools.length === 1 && text(input.school) === '') school = input.schools[0]
  else {
    school = input.schools.find((id) => String(id) === text(input.school))
    if (school === undefined) errors.school = 'Choose which school this file is for.'
  }

  const folderId = text(input.folder)
  let folder: Id | undefined
  if (folderId !== '' && school !== undefined) {
    const found = input.folders.find(
      (f) => String(f.id) === folderId && String(f.tenant) === String(school),
    )
    if (found) folder = found.id
    else errors.folder = 'Choose one of this school’s folders.'
  }

  const kind = input.file ? kindOf(input.file.type) : null
  const isDecorative = input.isDecorative === true
  if (input.file && !errors.file) {
    for (const problem of resourceProblems({
      mimeType: input.file.type,
      alt: input.alt,
      isDecorative,
      remediationStatus: input.remediationStatus,
    })) {
      errors[problem.path as UploadField] = problem.message
    }
  }

  if (Object.keys(errors).length > 0 || school === undefined) return { ok: false, errors }

  const data: Record<string, unknown> = { tenant: school, title }
  if (kind === 'image') {
    data.isDecorative = isDecorative
    if (!isDecorative) data.alt = text(input.alt)
  }
  if (kind === 'document') data.remediationStatus = input.remediationStatus
  if (text(input.description) !== '') data.description = text(input.description)
  if (text(input.tagsText) !== '') data.tagsText = text(input.tagsText)
  if (folder !== undefined) data.folder = folder
  return { ok: true, school, data }
}

/** "Lunch Menu_November.pdf" → "Lunch Menu November": a starting title, to be changed. */
export const titleFromFilename = (name: string): string =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const FAILURE = 'The file couldn’t be uploaded. Try again, or ask the district web team.'

/**
 * The server's refusal, as the form shows it: each field's message beside its field (Payload
 * keeps them in `errors[].data.errors`), anything else as one plain sentence.
 */
export const explainUploadError = (
  body: unknown,
): { fields: Partial<Record<UploadField, string>>; failure: string | null } => {
  const fields: Partial<Record<UploadField, string>> = {}
  const errors = (body as { errors?: unknown } | null)?.errors
  if (Array.isArray(errors)) {
    for (const error of errors as { data?: { errors?: unknown } }[]) {
      const inner = error?.data?.errors
      if (!Array.isArray(inner)) continue
      for (const field of inner as { path?: unknown; message?: unknown }[]) {
        if (typeof field?.path === 'string' && typeof field?.message === 'string') {
          fields[field.path as UploadField] = field.message
        }
      }
    }
  }
  return Object.keys(fields).length > 0 ? { fields, failure: null } : { fields, failure: FAILURE }
}
