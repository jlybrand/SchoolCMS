import sharp from 'sharp'

/**
 * Real, tiny files for upload tests (2026-11-13). Payload checks what it is given — a PDF must
 * carry its header, an xref table and `%%EOF` (`validatePDF`), an image must decode — so fakes
 * are refused, as they should be.
 */

let seq = 0
const name = (ext: string) => `test-${Date.now()}-${(seq += 1)}.${ext}`

const PDF = [
  '%PDF-1.4',
  '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj',
  '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj',
  '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>> endobj',
  'xref',
  '0 4',
  '0000000000 65535 f ',
  'trailer <</Size 4 /Root 1 0 R>>',
  'startxref',
  '0',
  '%%EOF',
  '',
].join('\n')

export const tinyPdf = () => {
  const data = Buffer.from(PDF, 'latin1')
  return { data, mimetype: 'application/pdf', name: name('pdf'), size: data.length }
}

export const tinyPng = async (width = 32, height = 24) => {
  const data = await sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 90, b: 160 } },
  })
    .png()
    .toBuffer()
  return { data, mimetype: 'image/png', name: name('png'), size: data.length }
}
