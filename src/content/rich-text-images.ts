import { getImageAssets } from './resources'
import type { RichTextImage } from './types'

/**
 * Images in the WORDS (Jason, 2026-11-19), filled in. A page is read at depth 0, so its rich text
 * names each library image by id (`{ kind: 'image', id, image: null }`, `toRichText`); this finds
 * every such node anywhere in what it is handed — a page's resolved sections, a post's body — and
 * fills them all from the library in ONE read (`getImageAssets`: images only). One that is gone,
 * or is not an image, stays null and renders nothing.
 *
 * Returns a copy; the input is not changed.
 */
const isUnfilled = (value: unknown): value is RichTextImage =>
  typeof value === 'object' &&
  value !== null &&
  (value as { kind?: unknown }).kind === 'image' &&
  (value as { image?: unknown }).image === null &&
  typeof (value as { id?: unknown }).id === 'string'

const collect = (value: unknown, ids: string[]): void => {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, ids)
    return
  }
  if (typeof value !== 'object' || value === null) return
  if (isUnfilled(value)) ids.push(value.id)
  for (const child of Object.values(value)) collect(child, ids)
}

const fill = (value: unknown, images: ReadonlyMap<string, unknown>): unknown => {
  if (Array.isArray(value)) return value.map((item) => fill(item, images))
  if (typeof value !== 'object' || value === null) return value
  if (isUnfilled(value)) return { ...value, image: images.get(value.id) ?? null }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, images)]))
}

export const fillRichTextImages = async <T>(value: T): Promise<T> => {
  const ids: string[] = []
  collect(value, ids)
  if (ids.length === 0) return value
  return fill(value, await getImageAssets(ids)) as T
}
