import type { ImageAsset } from './types'

/**
 * A library file → an image a page can show (Jason, 2026-11-13). PURE.
 *
 * - The alt text is the LIBRARY's — never re-entered on a page — and EMPTY for a decorative image
 *   (WCAG 1.1.1: decoration is skipped by a screen reader, not announced as a file name).
 * - `src` is the largest size Payload made (`hero`), falling back to the original; `srcSet` lists
 *   every size with its width, the original last, so a phone loads the small one.
 * - Anything that is not an image file is nothing.
 */

type Row = Record<string, unknown>
type Size = { url?: unknown; width?: unknown; height?: unknown }

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const SIZE_ORDER = ['thumbnail', 'card', 'hero'] as const

export const toImageAsset = (doc: unknown): ImageAsset | null => {
  if (typeof doc !== 'object' || doc === null) return null
  const row = doc as Row
  const url = str(row.url)
  if (row.kind !== 'image' || url === null) return null

  const sizes = (row.sizes ?? {}) as Record<string, Size | undefined>
  const made = SIZE_ORDER.flatMap((name) => {
    const size = sizes[name]
    const sizeUrl = str(size?.url)
    const width = num(size?.width)
    return sizeUrl !== null && width !== null
      ? [{ url: sizeUrl, width, height: num(size?.height) }]
      : []
  })
  const width = num(row.width)
  const largest = made[made.length - 1]
  const candidates = [...made.map((s) => `${s.url} ${s.width}w`)]
  if (width !== null) candidates.push(`${url} ${width}w`)

  return {
    src: largest?.url ?? url,
    width: largest?.width ?? width,
    height: largest?.height ?? num(row.height),
    alt: row.isDecorative === true ? '' : (str(row.alt) ?? ''),
    srcSet: candidates.join(', '),
  }
}
