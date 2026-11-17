import { describe, expect, it } from 'vitest'

import {
  ACCEPTED_MIME_TYPES,
  folderLabel,
  folderMovesUnder,
  kindOf,
  parseTags,
  replacementProblems,
  resourceProblems,
} from '@/lib/resources'

/**
 * The Resources library's rules (Jason, 2026-11-13). One library, two kinds of file, each with
 * its own rule: an IMAGE needs alt text unless it is marked decorative (CLAUDE.md rule 7); a
 * DOCUMENT needs its accessibility attestation (`07` §5 — the platform records it, it does not
 * remediate). No video (YouTube only, Jason) and no SVG (it can carry script).
 */

describe('kindOf', () => {
  it('images', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(kindOf(t)).toBe('image')
    }
  })

  it('documents', () => {
    for (const t of [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/msword',
    ]) {
      expect(kindOf(t)).toBe('document')
    }
  })

  it('nothing else — no video, no SVG, no executables', () => {
    for (const t of [
      'video/mp4',
      'text/vtt',
      'image/svg+xml',
      'application/x-msdownload',
      '',
      null,
    ]) {
      expect(kindOf(t as string)).toBeNull()
    }
  })

  it('the upload allowlist is exactly what kindOf accepts', () => {
    expect(ACCEPTED_MIME_TYPES.every((t) => kindOf(t) !== null)).toBe(true)
    expect(ACCEPTED_MIME_TYPES).not.toContain('image/svg+xml')
  })
})

describe('resourceProblems', () => {
  it('an image needs alt text, unless it is decorative', () => {
    expect(resourceProblems({ mimeType: 'image/png', alt: '  ' })).toEqual([
      {
        path: 'alt',
        message: 'Describe the image for people who can’t see it, or mark it decorative.',
      },
    ])
    expect(
      resourceProblems({ mimeType: 'image/png', alt: 'Students at the science fair' }),
    ).toEqual([])
    expect(resourceProblems({ mimeType: 'image/png', isDecorative: true })).toEqual([])
  })

  it('a document needs its accessibility attestation', () => {
    expect(resourceProblems({ mimeType: 'application/pdf' })).toEqual([
      {
        path: 'remediationStatus',
        message: 'Say whether this document has been checked for accessibility.',
      },
    ])
    for (const remediationStatus of ['attested', 'not-attested']) {
      expect(resourceProblems({ mimeType: 'application/pdf', remediationStatus })).toEqual([])
    }
  })

  /** Jason, 2026-11-16: no "Not needed" — a document is checked, or not checked yet. */
  it('"not needed" is not an answer: it is refused like no answer', () => {
    expect(
      resourceProblems({ mimeType: 'application/pdf', remediationStatus: 'not-applicable' }),
    ).toEqual([
      {
        path: 'remediationStatus',
        message: 'Say whether this document has been checked for accessibility.',
      },
    ])
  })

  it('a document needs no alt text; an image no attestation', () => {
    expect(
      resourceProblems({ mimeType: 'application/pdf', remediationStatus: 'attested' }),
    ).toEqual([])
    expect(resourceProblems({ mimeType: 'image/jpeg', alt: 'A bus' })).toEqual([])
  })

  it('a file of any other kind is refused', () => {
    expect(resourceProblems({ mimeType: 'video/mp4' })).toEqual([
      {
        path: 'file',
        message:
          'That kind of file can’t go in the library. Upload an image or a document; put video on YouTube.',
      },
    ])
  })
})

describe('parseTags', () => {
  it('splits on commas, trims, drops empties and repeats (any case)', () => {
    expect(parseTags(' Forms, lunch ,,forms, Lunch, Athletics ')).toEqual([
      'Forms',
      'lunch',
      'Athletics',
    ])
    expect(parseTags('')).toEqual([])
    expect(parseTags(undefined)).toEqual([])
  })
})

describe('folders', () => {
  const tree = new Map<string, string | null>([
    ['1', null],
    ['2', '1'],
    ['3', '2'],
    ['4', null],
  ])
  const parentOf = (id: string) => tree.get(id) ?? null

  it('a folder can’t go inside itself or anything inside it', () => {
    expect(folderMovesUnder('1', '3', parentOf)).toBe(false)
    expect(folderMovesUnder('2', '2', parentOf)).toBe(false)
    expect(folderMovesUnder('3', '4', parentOf)).toBe(true)
    expect(folderMovesUnder('3', null, parentOf)).toBe(true)
  })

  it('a folder is named with its path', () => {
    expect(folderLabel(['Forms'])).toBe('Forms')
    expect(folderLabel(['Forms', 'Enrollment', '2026'])).toBe('Forms › Enrollment › 2026')
  })
})

/** Replace a file (Jason, 2026-11-16): an image for an image, a document for a document. */
describe('replacementProblems', () => {
  it('the same kind is fine — any image for an image, any document for a document', () => {
    expect(replacementProblems('image/png', 'image/jpeg')).toEqual([])
    expect(replacementProblems('application/pdf', 'application/msword')).toEqual([])
  })

  it('a different kind is refused, at the file', () => {
    const refused = [
      { path: 'file', message: 'Replace an image with an image, or a document with a document.' },
    ]
    expect(replacementProblems('image/png', 'application/pdf')).toEqual(refused)
    expect(replacementProblems('application/pdf', 'image/webp')).toEqual(refused)
  })

  it('a type the library doesn’t take is left to the usual refusal', () => {
    expect(replacementProblems('image/png', 'video/mp4')).toEqual([])
  })
})
