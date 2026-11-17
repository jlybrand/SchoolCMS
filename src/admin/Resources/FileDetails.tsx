'use client'

import { useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { ReplaceFileForm } from '@/admin/SchoolPlane/ReplaceFileForm'
import { explainUploadError } from '@/admin/SchoolPlane/upload-file'
import { fileSizeLabel, fileTypeLabel } from '@/content/document-item'
import type { FileUses } from '@/lib/file-uses'

import { checkDetails, type DetailsField } from './file-library'
import styles from './FileLibrary.module.css'
import type { LibraryFile } from './library-data'
import { UsesList } from './UsesList'

type Props = {
  file: LibraryFile
  folders: readonly { id: string | number; label: string }[]
  uses: FileUses | null
  usedOn: string | null
  /** The list without this file open. */
  closeHref: string
}

type Sent = { ok: true } | { ok: false; fields: Record<string, string>; failure: string | null }

/** `PATCH /api/resources/<id>` — through access and every hook, as any route. */
const usePatch = (id: string | number) => {
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  return async (data: Record<string, unknown>): Promise<Sent> => {
    try {
      const res = await fetch(`${api}/resources/${String(id)}?depth=0`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) return { ok: true }
      const explained = explainUploadError(await res.json().catch(() => null))
      return {
        ok: false,
        fields: explained.fields as Record<string, string>,
        failure: explained.failure,
      }
    } catch {
      return { ok: false, fields: {}, failure: explainUploadError(null).failure }
    }
  }
}

/**
 * A file's details column in the file library (Jason, 2026-11-17): everything about one file,
 * in place. Its details (title, description, tags, an image's description), its folder, a
 * replacement, where it's used, and delete — behind a pop-up listing where it's used, with
 * "Delete anyway".
 *
 * Every change goes through REST, so access and every server rule decide (alt required, the
 * kind lock, a folder of the file's own site, the activity log). After a change the view is read
 * again from the server (`router.refresh()`). Focus moves to the file's heading when a file is
 * opened, so a keyboard or screen-reader user lands on what they chose.
 *
 * Built, then locked with Playwright + axe (CLAUDE.md's exception for admin views):
 * `tests/e2e/file-library.spec.ts`.
 */
export const FileDetails = ({ file, folders, uses, usedOn, closeHref }: Props) => {
  const router = useRouter()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const isImage = file.kind === 'image'

  useEffect(() => {
    headingRef.current?.focus()
  }, [file.id])

  return (
    <section aria-labelledby="file-heading" className={styles.details} id="file-details">
      <p className={styles.back}>
        <Link href={closeHref}>Back to the files</Link>
      </p>
      <h2 className={styles.fileTitle} id="file-heading" ref={headingRef} tabIndex={-1}>
        {file.title}
      </h2>
      {isImage && file.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- the library's own thumbnail
        <img alt="" className={styles.preview} src={file.thumbnail} />
      ) : null}
      <p className={styles.meta}>
        {[isImage ? 'Image' : fileTypeLabel(file.mimeType), fileSizeLabel(file.filesize)]
          .filter(Boolean)
          .join(', ')}
        {file.url ? (
          <>
            {' · '}
            <a href={file.url}>Open it</a>
          </>
        ) : null}
        {' · '}
        <Link href={`/admin/collections/resources/${String(file.id)}`}>Its full page</Link>
      </p>
      {file.filename ? <p className={styles.address}>File name: {file.filename}</p> : null}

      <DetailsForm file={file} onSaved={() => router.refresh()} />
      <MoveForm file={file} folders={folders} onMoved={() => router.refresh()} />

      <section aria-labelledby="replace-heading" className={styles.part}>
        <h3 className={styles.partTitle} id="replace-heading">
          Replace the file
        </h3>
        <div id="replace-file">
          <ReplaceFileForm file={file} usedOn={usedOn} />
        </div>
      </section>

      {uses ? (
        <section aria-labelledby="uses-heading" className={styles.part} id="library-used-on">
          <h3 className={styles.partTitle} id="uses-heading">
            Where it’s used
          </h3>
          <UsesList headingLevel={4} uses={uses} />
        </section>
      ) : null}

      <DeleteFile closeHref={closeHref} file={file} uses={uses} />
    </section>
  )
}

const DetailsForm = ({ file, onSaved }: { file: LibraryFile; onSaved: () => void }) => {
  const id = useId()
  const patch = usePatch(file.id)
  const [title, setTitle] = useState(file.title)
  const [description, setDescription] = useState(file.description)
  const [tags, setTags] = useState(file.tagsText)
  const [alt, setAlt] = useState(file.alt)
  const [decorative, setDecorative] = useState(file.isDecorative)
  const [errors, setErrors] = useState<Partial<Record<DetailsField, string>>>({})
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fieldId = (f: string) => `${id}-${f}`
  const errorId = (f: DetailsField) => `${id}-${f}-error`

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setMessage(null)
    const check = checkDetails({
      kind: file.kind,
      title,
      description,
      tagsText: tags,
      alt,
      isDecorative: decorative,
    })
    if (!check.ok) {
      setErrors(check.errors)
      const firstField = (['title', 'alt'] as const).find((f) => check.errors[f])
      if (firstField) document.getElementById(fieldId(firstField))?.focus()
      return
    }
    setErrors({})
    setBusy(true)
    const sent = await patch(check.data)
    setBusy(false)
    if (sent.ok) {
      setMessage({ ok: true, text: 'Saved.' })
      onSaved()
    } else {
      setErrors(sent.fields as Partial<Record<DetailsField, string>>)
      setMessage({ ok: false, text: sent.failure ?? 'That didn’t save. Check the details above.' })
    }
  }

  const described = (f: DetailsField) =>
    errors[f] ? { 'aria-describedby': errorId(f), 'aria-invalid': true } : {}
  const error = (f: DetailsField) =>
    errors[f] ? (
      <p className={styles.error} id={errorId(f)}>
        {errors[f]}
      </p>
    ) : null

  return (
    <section aria-labelledby={`${id}-heading`} className={styles.part}>
      <h3 className={styles.partTitle} id={`${id}-heading`}>
        Details
      </h3>
      <form className={styles.form} noValidate onSubmit={(e) => void onSubmit(e)}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId('title')}>
            Title (required)
          </label>
          {error('title')}
          <input
            className={styles.input}
            id={fieldId('title')}
            onChange={(e) => setTitle(e.target.value)}
            type="text"
            value={title}
            {...described('title')}
          />
        </div>
        {file.kind === 'image' ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={fieldId('alt')}>
              Describe the image
            </label>
            <p className={styles.hint} id={`${id}-alt-hint`}>
              For people who can’t see it. Required unless it’s decorative.
            </p>
            {error('alt')}
            <textarea
              aria-describedby={[errors.alt ? errorId('alt') : null, `${id}-alt-hint`]
                .filter(Boolean)
                .join(' ')}
              className={styles.input}
              disabled={decorative}
              id={fieldId('alt')}
              onChange={(e) => setAlt(e.target.value)}
              rows={3}
              value={alt}
              {...(errors.alt ? { 'aria-invalid': true } : {})}
            />
            <div className={styles.choice}>
              <input
                checked={decorative}
                id={fieldId('decorative')}
                onChange={(e) => setDecorative(e.target.checked)}
                type="checkbox"
              />
              <label htmlFor={fieldId('decorative')}>This image is decorative</label>
            </div>
          </div>
        ) : null}
        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId('description')}>
            Description
          </label>
          <textarea
            className={styles.input}
            id={fieldId('description')}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            value={description}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId('tags')}>
            Tags
          </label>
          <p className={styles.hint} id={`${id}-tags-hint`}>
            Separate tags with commas, for example “forms, enrollment”.
          </p>
          <input
            aria-describedby={`${id}-tags-hint`}
            className={styles.input}
            id={fieldId('tags')}
            onChange={(e) => setTags(e.target.value)}
            type="text"
            value={tags}
          />
        </div>
        {message ? (
          <p
            className={message.ok ? styles.done : styles.failure}
            role={message.ok ? 'status' : 'alert'}
          >
            {message.text}
          </p>
        ) : null}
        <button className={styles.button} disabled={busy} type="submit">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </section>
  )
}

const MoveForm = ({
  file,
  folders,
  onMoved,
}: {
  file: LibraryFile
  folders: Props['folders']
  onMoved: () => void
}) => {
  const id = useId()
  const patch = usePatch(file.id)
  const [folder, setFolder] = useState(file.folderId ?? '')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage(null)
    const sent = await patch({ folder: folder === '' ? null : Number(folder) })
    setBusy(false)
    if (sent.ok) {
      setMessage({ ok: true, text: 'Moved.' })
      onMoved()
    } else {
      setMessage({
        ok: false,
        text: sent.fields.folder ?? sent.failure ?? 'That didn’t move. Try again.',
      })
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className={styles.part}>
      <h3 className={styles.partTitle} id={`${id}-heading`}>
        Folder
      </h3>
      <form className={styles.inline} onSubmit={(e) => void onSubmit(e)}>
        <label className={styles.label} htmlFor={`${id}-folder`}>
          Move to
        </label>
        <select
          className={styles.select}
          id={`${id}-folder`}
          onChange={(e) => setFolder(e.target.value)}
          value={folder}
        >
          <option value="">Not in a folder</option>
          {folders.map((f) => (
            <option key={String(f.id)} value={String(f.id)}>
              {f.label}
            </option>
          ))}
        </select>
        <button
          className={styles.button}
          disabled={busy || folder === (file.folderId ?? '')}
          type="submit"
        >
          {busy ? 'Moving…' : 'Move'}
        </button>
      </form>
      {message ? (
        <p
          className={message.ok ? styles.done : styles.failure}
          role={message.ok ? 'status' : 'alert'}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  )
}

/**
 * Delete, behind a NATIVE `<dialog>` (as `PastePrompt`): focus moves in and is trapped, Escape
 * cancels, focus goes back to the button. A file in use lists where (Jason: a warning, with the
 * option to delete anyway); Cancel is focused first, so Enter never deletes by accident.
 */
const DeleteFile = ({
  file,
  uses,
  closeHref,
}: {
  file: LibraryFile
  uses: FileUses | null
  closeHref: string
}) => {
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const used =
    uses !== null && uses.pages.length + uses.announcements.length + uses.linked.length > 0

  const onDelete = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const res = await fetch(`${api}/resources/${String(file.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        dialogRef.current?.close()
        router.push(`${closeHref}${closeHref.includes('?') ? '&' : '?'}done=deleted`)
        router.refresh()
        return
      }
      setFailure('That file couldn’t be deleted. Try again, or ask the district web team.')
    } catch {
      setFailure('That file couldn’t be deleted. Check your connection and try again.')
    }
    setBusy(false)
  }

  return (
    <section aria-labelledby={`${titleId}-part`} className={styles.part}>
      <h3 className={styles.partTitle} id={`${titleId}-part`}>
        Delete
      </h3>
      <button
        className={styles.dangerButton}
        onClick={() => {
          dialogRef.current?.showModal()
          // React keeps `autoFocus` to itself, so the dialog never sees it: focus Cancel here.
          cancelRef.current?.focus()
        }}
        type="button"
      >
        Delete this file
      </button>
      <dialog
        aria-labelledby={titleId}
        className={styles.dialog}
        id="delete-file-dialog"
        ref={dialogRef}
      >
        <h2 className={styles.dialogTitle} id={titleId}>
          Delete “{file.title}”?
        </h2>
        {used && uses ? (
          <>
            <p>
              It’s used on these published pages and announcements. They’ll show nothing in its
              place.
            </p>
            <UsesList uses={uses} />
          </>
        ) : (
          <p>It isn’t used on any published page or announcement.</p>
        )}
        <p>This can’t be undone.</p>
        {failure ? (
          <p className={styles.failure} role="alert">
            {failure}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <button
            className={styles.button}
            onClick={() => dialogRef.current?.close()}
            ref={cancelRef}
            type="button"
          >
            Cancel
          </button>
          <button
            className={styles.dangerButton}
            disabled={busy}
            onClick={() => void onDelete()}
            type="button"
          >
            {busy ? 'Deleting…' : used ? 'Delete anyway' : 'Delete'}
          </button>
        </div>
      </dialog>
    </section>
  )
}
