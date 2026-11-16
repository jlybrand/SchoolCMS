import type { DocumentItem } from './types'

/**
 * A library document → a row of a Document list (Jason, 2026-11-16). PURE.
 *
 * - The link names the file's TYPE and SIZE ("PDF, 240 KB"), so nobody opens a 12 MB spreadsheet
 *   expecting a page (WCAG 2.4.4, link purpose).
 * - A document nobody has checked for accessibility (`not-attested`) is still listed, and
 *   `unchecked` says to add the note offering an accessible copy (`07` §5). A checked document
 *   gets no note.
 * - Anything that is not a document, or has no address or title, is nothing.
 */

type Row = Record<string, unknown>

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-powerpoint': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
}

/** What a visitor would call the file: "PDF", "Word", … — never a MIME type. */
export const fileTypeLabel = (mimeType: unknown): string =>
  (typeof mimeType === 'string' && TYPE_LABELS[mimeType]) || 'File'

const KB = 1024
const MB = 1024 * 1024

/** "240 KB", "3.5 MB"; anything under a kilobyte reads as 1 KB. Unknown: none. */
export const fileSizeLabel = (bytes: unknown): string | null => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / KB))} KB`
  const mb = Math.round((bytes / MB) * 10) / 10
  return `${Number.isInteger(mb) ? mb.toFixed(0) : mb.toFixed(1)} MB`
}

export const toDocumentItem = (doc: unknown): DocumentItem | null => {
  if (typeof doc !== 'object' || doc === null) return null
  const row = doc as Row
  const href = str(row.url)
  const title = str(row.title)
  if (row.kind !== 'document' || href === null || title === null) return null
  if (row.id === undefined || row.id === null) return null
  return {
    id: String(row.id),
    title,
    href,
    fileType: fileTypeLabel(row.mimeType),
    fileSize: fileSizeLabel(row.filesize),
    description: str(row.description),
    unchecked: row.remediationStatus === 'not-attested',
  }
}
