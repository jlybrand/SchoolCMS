import { describe, expect, it } from 'vitest'

import { checkReplace } from '@/admin/SchoolPlane/replace-file'
import { MAX_UPLOAD_BYTES } from '@/admin/SchoolPlane/upload-file'

/**
 * "Replace a file" on the school plane (Jason, 2026-11-16). A new file in the old one's place —
 * the same kind only — keeping its library entry, so every page using it shows the new one. For
 * an image the description is asked again (prefilled), and sending it is the confirmation; a
 * document is marked not checked by the server, so nothing is asked. No approval.
 */

const image = { kind: 'image' as const, mimeType: 'image/png' }
const doc = { kind: 'document' as const, mimeType: 'application/pdf' }
const png = { name: 'fair-2026.png', type: 'image/png', size: 2_000 }
const pdf = { name: 'menu-dec.pdf', type: 'application/pdf', size: 9_000 }

describe('checkReplace', () => {
  it('an image for an image, with its description confirmed', () => {
    expect(checkReplace({ original: image, file: png, alt: ' Students at the fair ' })).toEqual({
      ok: true,
      data: { alt: 'Students at the fair', isDecorative: false },
    })
  })

  it('a decorative image needs no description', () => {
    expect(checkReplace({ original: image, file: png, isDecorative: true })).toEqual({
      ok: true,
      data: { isDecorative: true },
    })
  })

  it('a document for a document asks nothing more', () => {
    expect(checkReplace({ original: doc, file: pdf })).toEqual({ ok: true, data: {} })
  })

  it('no file, too big, or a different kind — each said at the file', () => {
    expect(checkReplace({ original: doc, file: null })).toEqual({
      ok: false,
      errors: { file: 'Choose the new file.' },
    })
    expect(checkReplace({ original: doc, file: { ...pdf, size: MAX_UPLOAD_BYTES + 1 } })).toEqual({
      ok: false,
      errors: { file: 'That file is too big — 25 MB at most.' },
    })
    expect(checkReplace({ original: doc, file: png })).toEqual({
      ok: false,
      errors: { file: 'Replace an image with an image, or a document with a document.' },
    })
  })

  it('an image with its description emptied is refused, in the library’s words', () => {
    expect(checkReplace({ original: image, file: png, alt: '  ' })).toEqual({
      ok: false,
      errors: { alt: 'Describe the image for people who can’t see it, or mark it decorative.' },
    })
  })
})
