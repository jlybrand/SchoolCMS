import { SITE_PAGES_PATH } from '@/admin/SitePages/site-pages'

/**
 * The short menus of actions at the top of the side navigation (Jason, 2026-11-13; scope settled
 * 2026-11-18) — PURE. Verbs, not collections: Payload's collection list is folded under
 * "Everything else" below. The district's, and a school manager's — the same, less what is the
 * district's (Jason, 2026-11-18: "school should get a similar workflow").
 *
 * `panel` items slide out a list beside the menu that drills down in place (`SiteFlyout`): a
 * site's pages, the boards, the calendars, or every folder and its files. The rest are links. The ids are the
 * ones Approvals and the file library already had, so links to them keep working.
 */

/** What the panel beside the menu lists: a site's pages, every board, calendar or folder. */
export type PanelKind = 'pages' | 'boards' | 'calendars' | 'files'

export type MenuItem = {
  id: string
  label: string
  href: string
  /** Also current on these paths (and anything under them). */
  also?: readonly string[]
  panel?: PanelKind
}

/**
 * The event a "Change site" / "Choose a folder" button on a screen sends, so it opens the same
 * panel the menu does: `new CustomEvent(OPEN_PANEL_EVENT, { detail: kind })` on `window`.
 */
export const OPEN_PANEL_EVENT = 'dd2:open-panel'

const PAGES: MenuItem = {
  id: 'nav-menu-pages',
  label: 'Pages',
  href: SITE_PAGES_PATH,
  also: ['/admin/collections/pages', '/admin/update-page', '/admin/new-page'],
  panel: 'pages',
}
const ANNOUNCEMENTS: MenuItem = {
  id: 'nav-menu-posts',
  label: 'Announcements',
  href: '/admin/collections/posts',
  also: ['/admin/new-post'],
  panel: 'boards',
}
const EVENTS: MenuItem = {
  id: 'nav-menu-events',
  label: 'Events',
  href: '/admin/collections/events',
  also: ['/admin/new-event', '/admin/collections/calendars'],
  panel: 'calendars',
}
const FILES: MenuItem = {
  id: 'nav-file-library',
  label: 'Files',
  href: '/admin/file-library',
  also: ['/admin/collections/resources', '/admin/upload-file', '/admin/replace-file'],
  panel: 'files',
}

export const DISTRICT_MENU: readonly MenuItem[] = [
  { id: 'nav-approvals', label: 'Approvals', href: '/admin/approvals' },
  PAGES,
  ANNOUNCEMENTS,
  EVENTS,
  { id: 'nav-menu-alerts', label: 'Alerts', href: '/admin/collections/alerts' },
  { id: 'nav-menu-users', label: 'Users', href: '/admin/collections/users' },
  FILES,
]

export const SCHOOL_MENU: readonly MenuItem[] = [PAGES, ANNOUNCEMENTS, EVENTS, FILES]

const under = (pathname: string, base: string): boolean =>
  pathname === base || pathname.startsWith(`${base}/`)

export const isCurrent = (item: MenuItem, pathname: string): boolean =>
  [item.href, ...(item.also ?? [])].some((base) => under(pathname, base))
