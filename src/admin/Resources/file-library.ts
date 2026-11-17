import { resourceProblems, type ResourceKind } from '@/lib/resources'

/**
 * The file library screen's rules (Jason, 2026-11-17) — PURE. The screen
 * (`/admin/file-library`, `FileLibraryView`) is rendered from its address, so the back button,
 * reloads and shared links work, and nothing is held in client state. These say what an address
 * means (`libraryParams`), how a link changes it (`libraryHref`), how the folders nest
 * (`folderTree`), and what the details form sends (`checkDetails`).
 */

export const LIBRARY_PATH = '/admin/file-library'
export const PAGE_SIZE = 50
const MAX_PAGE = 1000
const MAX_QUERY = 100

export type LibraryParams = {
  /** The site's tenant id; null until the district picks one. */
  site: string | null
  folder: 'all' | string
  q: string
  kind: ResourceKind | null
  page: number
  /** The open file, or null. */
  file: string | null
}

type Raw = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

const idOrNull = (value: string | undefined): string | null =>
  value !== undefined && /^\d+$/.test(value) ? value : null

export const libraryParams = (raw: Raw): LibraryParams => {
  const page = Number.parseInt(first(raw.page) ?? '', 10)
  const kind = first(raw.kind)
  return {
    site: idOrNull(first(raw.site)),
    folder: idOrNull(first(raw.folder)) ?? 'all',
    q: (first(raw.q) ?? '').trim().slice(0, MAX_QUERY),
    kind: kind === 'image' || kind === 'document' ? kind : null,
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
    file: idOrNull(first(raw.file)),
  }
}

/**
 * The address after one change. A new site starts over; a new folder, search or kind starts at
 * page 1 with no file open; a new page closes the file. Defaults are left out.
 */
export const libraryHref = (at: LibraryParams, change: Partial<LibraryParams>): string => {
  let next: LibraryParams = { ...at, ...change }
  if ('site' in change && change.site !== at.site) {
    next = { site: change.site ?? null, folder: 'all', q: '', kind: null, page: 1, file: null }
  } else if ('folder' in change || 'q' in change || 'kind' in change) {
    next = { ...next, page: 1, file: 'file' in change ? (change.file ?? null) : null }
  } else if ('page' in change && !('file' in change)) {
    next = { ...next, file: null }
  }
  const query = new URLSearchParams()
  if (next.site !== null) query.set('site', next.site)
  if (next.folder !== 'all') query.set('folder', next.folder)
  if (next.q !== '') query.set('q', next.q)
  if (next.kind !== null) query.set('kind', next.kind)
  if (next.page !== 1) query.set('page', String(next.page))
  if (next.file !== null) query.set('file', next.file)
  const text = query.toString()
  return text === '' ? LIBRARY_PATH : `${LIBRARY_PATH}?${text}`
}

export type FolderRow = { id: string | number; name?: unknown; parent?: unknown }
export type FolderNode = { id: string; name: string; children: FolderNode[] }

const refOf = (value: unknown): string | null => {
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  if (typeof value === 'object' && value !== null && 'id' in value) {
    return refOf((value as { id: unknown }).id)
  }
  return null
}

/**
 * The site's folders, nested, A–Z at every level. A folder whose parent is missing sits at the
 * top rather than vanishing; a cycle in bad data is broken, never followed.
 */
export const folderTree = (rows: readonly FolderRow[]): FolderNode[] => {
  const nodes = new Map<string, FolderNode>()
  for (const row of rows) {
    const id = String(row.id)
    nodes.set(id, { id, name: typeof row.name === 'string' ? row.name : id, children: [] })
  }
  const parentOf = new Map(rows.map((r) => [String(r.id), refOf(r.parent)]))
  const reachesTop = (id: string): boolean => {
    const seen = new Set<string>()
    let at: string | null = id
    while (at !== null) {
      if (seen.has(at)) return false
      seen.add(at)
      const up: string | null = parentOf.get(at) ?? null
      if (up === null || !nodes.has(up)) return true
      at = up
    }
    return true
  }
  const top: FolderNode[] = []
  for (const [id, node] of nodes) {
    const parent = parentOf.get(id) ?? null
    if (parent !== null && nodes.has(parent) && reachesTop(id)) {
      nodes.get(parent)!.children.push(node)
    } else {
      top.push(node)
    }
  }
  const sort = (list: FolderNode[]): FolderNode[] => {
    list.sort((a, b) => a.name.localeCompare(b.name))
    for (const n of list) sort(n.children)
    return list
  }
  return sort(top)
}

export type DetailsField = 'title' | 'alt'
export type DetailsInput = {
  kind: ResourceKind
  title?: unknown
  description?: unknown
  tagsText?: unknown
  alt?: unknown
  isDecorative?: unknown
}
export type DetailsCheck =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: Partial<Record<DetailsField, string>> }

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/**
 * The details form (title, description, tags, and an image's description) in the library's own
 * words; the server's rules (`resourceProblems`, on every route) still decide. An emptied
 * description or tags are sent empty, so they clear.
 */
export const checkDetails = (input: DetailsInput): DetailsCheck => {
  const errors: Partial<Record<DetailsField, string>> = {}
  const title = text(input.title)
  if (title === '') errors.title = 'Give the file a title.'
  const decorative = input.isDecorative === true
  if (input.kind === 'image') {
    const [problem] = resourceProblems({
      mimeType: 'image/png',
      alt: input.alt,
      isDecorative: decorative,
    })
    if (problem?.path === 'alt') errors.alt = problem.message
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const data: Record<string, unknown> = {
    title,
    description: text(input.description),
    tagsText: text(input.tagsText),
  }
  if (input.kind === 'image') {
    data.isDecorative = decorative
    if (!decorative) data.alt = text(input.alt)
  }
  return { ok: true, data }
}
