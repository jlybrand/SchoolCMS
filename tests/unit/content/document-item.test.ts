import { describe, expect, it } from 'vitest'

import { fileTypeLabel, fileSizeLabel, toDocumentItem } from '@/content/document-item'

/**
 * A library document as a Document list shows it (Jason, 2026-11-16). The link names the file's
 * type and size, so nobody downloads a 12 MB spreadsheet expecting a page (WCAG 2.4.4). A
 * document nobody has checked for accessibility is still listed — with a note (`07` §5).
 */

const doc = {
  id: 7,
  kind: 'document',
  title: '  Enrollment form  ',
  description: '  Fill in and return to the office.  ',
  url: '/api/resources/file/enrollment.pdf',
  mimeType: 'application/pdf',
  filesize: 245_760,
  remediationStatus: 'attested',
}

describe('toDocumentItem', () => {
  it('its title, link, type and size, description, and whether it needs the note', () => {
    expect(toDocumentItem(doc)).toEqual({
      id: '7',
      title: 'Enrollment form',
      href: '/api/resources/file/enrollment.pdf',
      fileType: 'PDF',
      fileSize: '240 KB',
      description: 'Fill in and return to the office.',
      unchecked: false,
    })
  })

  it('not checked for accessibility: listed, with the note; checked: no note', () => {
    expect(toDocumentItem({ ...doc, remediationStatus: 'not-attested' })?.unchecked).toBe(true)
    expect(toDocumentItem({ ...doc, remediationStatus: 'attested' })?.unchecked).toBe(false)
  })

  it('an image, a file with no address, or no title is nothing', () => {
    expect(toDocumentItem({ ...doc, kind: 'image' })).toBeNull()
    expect(toDocumentItem({ ...doc, url: '' })).toBeNull()
    expect(toDocumentItem({ ...doc, title: ' ' })).toBeNull()
    expect(toDocumentItem(null)).toBeNull()
  })

  it('no description is none', () => {
    expect(toDocumentItem({ ...doc, description: '   ' })?.description).toBeNull()
  })
})

describe('fileTypeLabel — what a visitor would call it', () => {
  it.each([
    ['application/pdf', 'PDF'],
    ['application/msword', 'Word'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Word'],
    ['application/vnd.ms-excel', 'Excel'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel'],
    ['application/vnd.ms-powerpoint', 'PowerPoint'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PowerPoint'],
  ])('%s is %s', (mime, label) => {
    expect(fileTypeLabel(mime)).toBe(label)
  })

  it('anything else is a plain "File"', () => {
    expect(fileTypeLabel('application/zip')).toBe('File')
    expect(fileTypeLabel(undefined)).toBe('File')
  })
})

describe('fileSizeLabel', () => {
  it.each([
    [512, '1 KB'],
    [245_760, '240 KB'],
    [1_048_576, '1 MB'],
    [3_670_016, '3.5 MB'],
    [12_582_912, '12 MB'],
  ])('%d bytes is %s', (bytes, label) => {
    expect(fileSizeLabel(bytes)).toBe(label)
  })

  it('an unknown size is none', () => {
    expect(fileSizeLabel(undefined)).toBeNull()
    expect(fileSizeLabel(0)).toBeNull()
  })
})
