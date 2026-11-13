import { describe, expect, it } from 'vitest'

import {
  checkUpload,
  explainUploadError,
  MAX_UPLOAD_BYTES,
  titleFromFilename,
} from '@/admin/SchoolPlane/upload-file'

/**
 * "Upload a file" on the school plane (Jason, 2026-11-13). The form asks what a file can't go in
 * without — and only what its kind needs: alt text (or decorative) for an image, the
 * accessibility answer for a document — in the library's own words, so the form and the server
 * never disagree. A school's own folders only; no approval.
 */

const png = { name: 'science-fair.png', type: 'image/png', size: 2_000 }
const pdf = { name: 'Lunch Menu_November.pdf', type: 'application/pdf', size: 9_000 }
const one = { schools: [7], folders: [{ id: 3, tenant: 7, label: 'Forms' }] }

describe('checkUpload', () => {
  it('an image with a title and alt text, for the one school', () => {
    expect(checkUpload({ ...one, file: png, title: ' Science fair ', alt: ' Students ' })).toEqual({
      ok: true,
      school: 7,
      data: { tenant: 7, title: 'Science fair', alt: 'Students', isDecorative: false },
    })
  })

  it('a decorative image needs no alt text', () => {
    expect(checkUpload({ ...one, file: png, title: 'Divider', isDecorative: true })).toMatchObject({
      ok: true,
      data: { isDecorative: true },
    })
  })

  it('a document with its answer, description, tags and folder', () => {
    expect(
      checkUpload({
        ...one,
        file: pdf,
        title: 'Lunch menu',
        remediationStatus: 'attested',
        description: ' November ',
        tagsText: 'lunch, menus',
        folder: '3',
      }),
    ).toEqual({
      ok: true,
      school: 7,
      data: {
        tenant: 7,
        title: 'Lunch menu',
        remediationStatus: 'attested',
        description: 'November',
        tagsText: 'lunch, menus',
        folder: 3,
      },
    })
  })

  it('says what is missing, beside each field, in the library’s words', () => {
    expect(checkUpload({ ...one, file: null, title: '' })).toEqual({
      ok: false,
      errors: { file: 'Choose a file to upload.', title: 'Give the file a title.' },
    })
    expect(checkUpload({ ...one, file: png, title: 'x' })).toEqual({
      ok: false,
      errors: { alt: 'Describe the image for people who can’t see it, or mark it decorative.' },
    })
    expect(checkUpload({ ...one, file: pdf, title: 'x' })).toEqual({
      ok: false,
      errors: {
        remediationStatus: 'Say whether this document has been checked for accessibility.',
      },
    })
  })

  it('refuses video, SVG and anything else, and a file over the limit', () => {
    expect(
      checkUpload({ ...one, file: { name: 'clip.mp4', type: 'video/mp4', size: 10 }, title: 'x' }),
    ).toEqual({
      ok: false,
      errors: {
        file: 'That kind of file can’t go in the library. Upload an image or a document; put video on YouTube.',
      },
    })
    expect(
      checkUpload({
        ...one,
        file: { ...pdf, size: MAX_UPLOAD_BYTES + 1 },
        title: 'x',
        remediationStatus: 'attested',
      }),
    ).toEqual({ ok: false, errors: { file: 'That file is too big — 25 MB at most.' } })
  })

  it('a manager of several schools chooses one; a folder must be that school’s', () => {
    const two = { schools: [7, 8], folders: [{ id: 3, tenant: 7, label: 'Forms' }] }
    expect(checkUpload({ ...two, file: png, title: 'x', alt: 'y' })).toEqual({
      ok: false,
      errors: { school: 'Choose which school this file is for.' },
    })
    expect(
      checkUpload({ ...two, file: png, title: 'x', alt: 'y', school: '8', folder: '3' }),
    ).toEqual({ ok: false, errors: { folder: 'Choose one of this school’s folders.' } })
    expect(checkUpload({ schools: [], folders: [], file: png, title: 'x', alt: 'y' })).toEqual({
      ok: false,
      errors: {
        school: 'Your account is not linked to a school yet. Ask the district web team to add it.',
      },
    })
  })
})

describe('titleFromFilename', () => {
  it('a readable starting title from the file’s name', () => {
    expect(titleFromFilename('Lunch Menu_November.pdf')).toBe('Lunch Menu November')
    expect(titleFromFilename('science-fair.final.png')).toBe('science fair final')
    expect(titleFromFilename('')).toBe('')
  })
})

describe('explainUploadError', () => {
  it('puts the server’s field messages beside their fields', () => {
    expect(
      explainUploadError({
        errors: [
          {
            data: {
              errors: [
                {
                  path: 'alt',
                  message: 'Describe the image for people who can’t see it, or mark it decorative.',
                },
              ],
            },
          },
        ],
      }),
    ).toEqual({
      fields: { alt: 'Describe the image for people who can’t see it, or mark it decorative.' },
      failure: null,
    })
  })

  it('anything else is one plain sentence', () => {
    expect(explainUploadError(null)).toEqual({
      fields: {},
      failure: 'The file couldn’t be uploaded. Try again, or ask the district web team.',
    })
  })
})
