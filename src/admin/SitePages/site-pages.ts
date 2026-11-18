import { submissionStatus } from '@/admin/SchoolPlane/school-plane'
import { ROOT_SLUG } from '@/lib/slug'

/**
 * A site's pages, as the district sees them (Jason, 2026-11-18: Pages → choose a site → its
 * page tree) — PURE. The screen (`/admin/site-pages`, `SitePagesView`) is rendered from its
 * address, so Back, reloads and shared links work. These say what an address means
 * (`sitePagesParams`), how a link is written (`sitePagesHref`), how the pages nest (`pageTree`)
 * and what each row says about itself (`pageStatusLabels`).
 *
 * Unlike `page-tree.ts` (public paths, published rows only), this is the ADMIN's tree: every
 * page of the site, drafts included, and none may go missing — a page whose parent is not listed
 * is shown at the top and marked, never dropped.
 */

export const SITE_PAGES_PATH = '/admin/site-pages'
/** The inline new-page form's anchor, so "Add a page here" lands on it. */
export const NEW_PAGE_ANCHOR = 'new-page'

export type SitePagesParams = {
  /** The site's tenant id; null until one is chosen. */
  site: string | null
  /** Where a new page is being added: under a page (its id), at the top, or nowhere. */
  new: string | null
}

type Raw = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

const idOrNull = (value: string | undefined): string | null =>
  value !== undefined && /^\d+$/.test(value) ? value : null

export const sitePagesParams = (raw: Raw): SitePagesParams => {
  const asked = first(raw.new)
  return {
    site: idOrNull(first(raw.site)),
    new: asked === 'top' ? 'top' : idOrNull(asked),
  }
}

export const sitePagesHref = (at: { site?: string | null; new?: string | null }): string => {
  const query = new URLSearchParams()
  if (at.site) query.set('site', at.site)
  if (at.site && at.new) query.set('new', at.new)
  const search = query.toString()
  return `${SITE_PAGES_PATH}${search ? `?${search}` : ''}${at.site && at.new ? `#${NEW_PAGE_ANCHOR}` : ''}`
}

export type PageRow = {
  id: string | number
  title?: string | null
  slug?: string | null
  parent?: string | number | { id: string | number } | null
  _status?: 'draft' | 'published' | null
  reviewState?: string | null
}

export type PageNode = {
  id: string
  title: string
  /** The site's front page (`tenant-root-decision`): listed first, and nothing nests under it. */
  frontPage: boolean
  /** Its parent is not among the site's pages: shown at the top so it is never lost. */
  orphan: boolean
  labels: string[]
  children: PageNode[]
}

const parentIdOf = (ref: PageRow['parent']): string | null => {
  if (ref === null || ref === undefined) return null
  return typeof ref === 'object' ? String(ref.id) : String(ref)
}

const byTitle = (a: PageNode, b: PageNode): number =>
  Number(b.frontPage) - Number(a.frontPage) ||
  a.title.localeCompare(b.title, 'en', { sensitivity: 'base' })

/** What a row says about itself: live or not, then anything waiting on it. */
export const pageStatusLabels = (row: Pick<PageRow, '_status' | 'reviewState'>): string[] => {
  const labels = [row._status === 'published' ? 'Live' : 'Not live yet']
  const pending = submissionStatus(row.reviewState)
  if (pending) labels.push(pending)
  return labels
}

export const pageTree = (rows: readonly PageRow[]): PageNode[] => {
  const nodes = new Map<string, PageNode>()
  const parentOf = new Map<string, string | null>()
  for (const row of rows) {
    const id = String(row.id)
    nodes.set(id, {
      id,
      title: row.title?.trim() || 'Untitled page',
      frontPage: row.slug === ROOT_SLUG && parentIdOf(row.parent) === null,
      orphan: false,
      labels: pageStatusLabels(row),
      children: [],
    })
    parentOf.set(id, parentIdOf(row.parent))
  }

  /** Whether following parents from `id` comes back to it — bounded by the number of pages. */
  const inCycle = (id: string): boolean => {
    let cursor = parentOf.get(id) ?? null
    for (let steps = 0; cursor !== null && steps <= nodes.size; steps++) {
      if (cursor === id) return true
      cursor = parentOf.get(cursor) ?? null
    }
    return false
  }

  const top: PageNode[] = []
  for (const [id, node] of nodes) {
    const parent = parentOf.get(id) ?? null
    const home = parent === null ? undefined : nodes.get(parent)
    if (home && !inCycle(id)) {
      home.children.push(node)
    } else {
      node.orphan = parent !== null
      top.push(node)
    }
  }

  const sort = (list: PageNode[]): PageNode[] => {
    list.sort(byTitle)
    list.forEach((n) => sort(n.children))
    return list
  }
  return sort(top)
}

export type SiteRow = { id: string | number; name?: string | null; type?: string | null }
export type SiteChoice = { id: string; name: string }

/** The "Choose a site" list: the district first, then the schools A–Z. */
export const siteChoices = (rows: readonly SiteRow[]): SiteChoice[] =>
  [...rows]
    .map((r) => ({
      id: String(r.id),
      name: r.name?.trim() || `Site ${String(r.id)}`,
      district: r.type === 'district',
    }))
    .sort(
      (a, b) =>
        Number(b.district) - Number(a.district) ||
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    )
    .map(({ id, name }) => ({ id, name }))
