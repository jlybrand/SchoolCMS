/**
 * The Resources library's rules (Jason, 2026-11-13). PURE. One library, two kinds of file:
 *
 * - IMAGE: alt text, unless marked decorative (CLAUDE.md rule 7 — this is the rule the field
 *   validation and the `beforeValidate` hook both ask).
 * - DOCUMENT: its accessibility attestation (`07` §5). The platform records it; it does not
 *   remediate. `not-attested` documents are the district's work queue.
 *
 * Nothing else: no video (YouTube only — Jason) and no SVG (it can carry script).
 */

export type ResourceKind = 'image' | 'document'

const IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

const DOCUMENTS = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const

/** What an upload may be — Payload refuses anything else before it is stored. */
export const ACCEPTED_MIME_TYPES: readonly string[] = [...IMAGES, ...DOCUMENTS]

export const kindOf = (mimeType: string | null | undefined): ResourceKind | null => {
  if (!mimeType) return null
  if ((IMAGES as readonly string[]).includes(mimeType)) return 'image'
  if ((DOCUMENTS as readonly string[]).includes(mimeType)) return 'document'
  return null
}

export const REMEDIATION_STATUSES = ['attested', 'not-attested', 'not-applicable'] as const

export type Problem = { path: string; message: string }

const filled = (value: unknown) => typeof value === 'string' && value.trim() !== ''

export const resourceProblems = (file: {
  mimeType?: string | null | undefined
  alt?: unknown
  isDecorative?: unknown
  remediationStatus?: unknown
}): Problem[] => {
  const kind = kindOf(file.mimeType)
  if (kind === null) {
    return [
      {
        path: 'file',
        message:
          'That kind of file can’t go in the library. Upload an image or a document; put video on YouTube.',
      },
    ]
  }
  if (kind === 'image' && file.isDecorative !== true && !filled(file.alt)) {
    return [
      {
        path: 'alt',
        message: 'Describe the image for people who can’t see it, or mark it decorative.',
      },
    ]
  }
  if (
    kind === 'document' &&
    !(REMEDIATION_STATUSES as readonly unknown[]).includes(file.remediationStatus)
  ) {
    return [
      {
        path: 'remediationStatus',
        message: 'Say whether this document has been checked for accessibility.',
      },
    ]
  }
  return []
}

/** "Forms, lunch ,forms" → ["Forms", "lunch"]: trimmed, no empties, no repeats in any case. */
export const parseTags = (value: unknown): string[] => {
  if (typeof value !== 'string') return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of value.split(',')) {
    const tag = raw.trim()
    if (tag === '' || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    tags.push(tag)
  }
  return tags
}

/**
 * Whether folder `id` may sit under `newParent`: never under itself or anything inside it. A
 * walk up from the new parent, bounded so a broken tree cannot loop.
 */
export const folderMovesUnder = (
  id: string,
  newParent: string | null,
  parentOf: (folder: string) => string | null,
): boolean => {
  let at = newParent
  for (let steps = 0; at !== null && steps < 100; steps += 1) {
    if (at === id) return false
    at = parentOf(at)
  }
  return true
}

/** A folder named with its path: "Forms › Enrollment › 2026". */
export const folderLabel = (path: readonly string[]): string => path.join(' › ')
