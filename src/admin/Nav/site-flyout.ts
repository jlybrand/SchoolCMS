import {
  folderTree,
  libraryHref,
  type FolderNode,
  type FolderRow,
} from '@/admin/Resources/file-library'
import { boardTree, type SiteNode } from '@/admin/Boards/board-tree'
import { feedNote } from '@/lib/feed-source'
import type { SiteChoice } from '@/admin/SitePages/site-pages'

/**
 * The "Choose a site" panel's drill-down (Jason, 2026-11-18) — PURE. Each level replaces the one
 * before it in the panel: Pages goes sites → the site's pages; Announcements opens on every board;
 * Events on every calendar;
 * Files opens on EVERY folder, under each site's name (Jason, 2026-11-18: no clicking through a
 * site first) → a folder's files. These say what each level asks the REST API for (read AS THE USER,
 * so access decides) and where a file leads. The panel itself is `SiteFlyout`.
 */

const query = (base: string, collection: string, entries: readonly [string, string][]): string =>
  `${base}/${collection}?${new URLSearchParams([...entries]).toString()}`

const select = (...fields: string[]): [string, string][] =>
  fields.map((f) => [`select[${f}]`, 'true'])

/** A site's pages, drafts included (a page not live yet is listed too). */
export const pagesQuery = (api: string, site: string): string =>
  query(api, 'pages', [
    ['where[tenant][equals]', site],
    ['draft', 'true'],
    ['depth', '0'],
    ['pagination', 'false'],
    ...select('title', 'slug', 'parent', '_status', 'reviewState'),
  ])

/** Every site's library folders, with the site each is on. */
export const allFoldersQuery = (api: string): string =>
  query(api, 'resource-folders', [
    ['depth', '0'],
    ['pagination', 'false'],
    ...select('name', 'parent', 'tenant'),
  ])

export type SiteFolders = { site: SiteChoice; folders: FolderNode[] }

const idOf = (value: unknown): string | null => {
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  if (typeof value === 'object' && value !== null && 'id' in value)
    return String((value as { id: unknown }).id)
  return null
}

/**
 * The folders under each site's name, in the sites' order (the district first, then A–Z), each
 * site's nested by `folderTree`. A site with no folders is left out, and so is a folder on a site
 * not in the list.
 */
export const foldersBySite = (
  rows: readonly (FolderRow & { tenant?: unknown })[],
  sites: readonly SiteChoice[],
): SiteFolders[] => {
  const bySite = new Map<string, FolderRow[]>()
  for (const row of rows) {
    const site = idOf(row.tenant)
    if (site === null) continue
    bySite.set(site, [...(bySite.get(site) ?? []), row])
  }
  return sites.flatMap((site) => {
    const own = bySite.get(site.id)
    return own ? [{ site, folders: folderTree(own) }] : []
  })
}

/** Every announcement board folder, with its site (`post-folders`, not the file library's). */
export const boardFoldersQuery = (api: string): string =>
  query(api, 'post-folders', [['depth', '0'], ['pagination', 'false'], ...select('name', 'tenant')])

/** Every announcement board, with its folder and site. */
export const boardsQuery = (api: string): string =>
  query(api, 'post-boards', [
    ['depth', '0'],
    ['pagination', 'false'],
    ...select('name', 'folder', 'tenant'),
  ])

/**
 * Site → folder → board (`boardTree`, as the boards screen), in the sites' order — the district
 * first, then A–Z — with a site that has no boards, and a folder with none, left out.
 */
export const boardsBySite = (
  folders: readonly { id: unknown; name?: unknown; tenant?: unknown }[],
  boards: readonly { id: unknown; name?: unknown; folder?: unknown }[],
  sites: readonly SiteChoice[],
): SiteNode[] => {
  const tree = new Map(boardTree(sites, folders, boards).map((site) => [site.id, site]))
  return sites.flatMap((site) => {
    const node = tree.get(site.id)
    const folders = node?.folders.filter((f) => f.boards.length > 0) ?? []
    return folders.length > 0 ? [{ ...node!, folders }] : []
  })
}

/** Every calendar, with its site, whether it is the main one, and where an imported one comes from. */
export const calendarsQuery = (api: string): string =>
  query(api, 'calendars', [
    ['depth', '0'],
    ['pagination', 'false'],
    ...select('name', 'isMain', 'tenant', 'source', 'feedUrl'),
  ])

export type CalendarChoice = {
  id: string
  name: string
  main: boolean
  /** An imported calendar's "This calendar is a feed from …"; null for one added to here. */
  feed: string | null
}
export type SiteCalendars = { site: SiteChoice; calendars: CalendarChoice[] }

/**
 * The calendars under each site's name, in the sites' order, the site's main calendar first and
 * the rest A–Z. A site with none is left out, and so is a calendar on a site not in the list.
 */
export const calendarsBySite = (
  rows: readonly {
    id: unknown
    name?: unknown
    isMain?: unknown
    tenant?: unknown
    source?: unknown
    feedUrl?: unknown
  }[],
  sites: readonly SiteChoice[],
): SiteCalendars[] => {
  const bySite = new Map<string, CalendarChoice[]>()
  for (const row of rows) {
    const site = idOf(row.tenant)
    if (site === null) continue
    const name =
      typeof row.name === 'string' && row.name.trim() ? row.name : `Calendar ${String(row.id)}`
    bySite.set(site, [
      ...(bySite.get(site) ?? []),
      {
        id: String(row.id),
        name,
        main: row.isMain === true,
        feed: row.source === 'feed' ? feedNote(row.feedUrl) : null,
      },
    ])
  }
  return sites.flatMap((site) => {
    const own = bySite.get(site.id)
    if (!own) return []
    own.sort(
      (a, b) =>
        Number(b.main) - Number(a.main) ||
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    )
    return [{ site, calendars: own }]
  })
}

/** A calendar's events: Payload's events list, filtered to it. */
export const calendarEventsHref = (calendar: string): string =>
  `/admin/collections/events?${new URLSearchParams([['where[calendar][equals]', calendar]]).toString()}`

/** One folder's files on one site, by title. */
export const filesQuery = (api: string, site: string, folder: string): string =>
  query(api, 'resources', [
    ['where[and][0][tenant][equals]', site],
    ['where[and][1][folder][equals]', folder],
    ['depth', '0'],
    ['pagination', 'false'],
    ['sort', 'title'],
    ...select('title', 'kind'),
  ])

/** A file opens in the file library, in its folder, with its details showing. */
export const fileHref = (site: string, folder: string, file: string): string =>
  libraryHref({ site, folder, q: '', kind: null, page: 1, file }, {})
