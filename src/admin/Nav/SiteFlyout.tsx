'use client'

import { useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { boardHref, createPostHref } from '@/admin/Announcements/announcements'
import type { FolderNode } from '@/admin/Resources/file-library'
import { schoolEditPath } from '@/admin/SchoolPlane/school-plane'
import {
  pageStatusLabels,
  pageTree,
  sitePagesHref,
  type PageNode,
  type SiteChoice,
} from '@/admin/SitePages/site-pages'

import type { PanelKind } from './action-menu'
import { FeedCalendarDialog } from './FeedCalendarDialog'
import styles from './Nav.module.css'
import {
  allFoldersQuery,
  boardFoldersQuery,
  boardsBySite,
  boardPostsQuery,
  boardsQuery,
  calendarEventsHref,
  calendarsBySite,
  calendarsQuery,
  BOARD_POSTS_SHOWN,
  type CalendarChoice,
  fileHref,
  filesQuery,
  foldersBySite,
  pagesQuery,
} from './site-flyout'

export type Plane = 'district' | 'school'

type Named = { id: string; name: string }
type Step =
  | { level: 'sites' }
  | { level: 'pages'; site: Named }
  | { level: 'boards' }
  | { level: 'posts'; site: Named; board: Named }
  | { level: 'calendars' }
  | { level: 'folders' }
  | { level: 'files'; site: Named; folder: Named }

type Row = { id: unknown; name?: unknown; tenant?: unknown; folder?: unknown; parent?: unknown }
type FileRow = { id: string | number; title?: string | null; kind?: string | null }
type PostRow = {
  id: string | number
  title?: string | null
  _status?: 'draft' | 'published' | null
  reviewState?: string | null
}
/** Each address's rows; null when it failed. A level already read is kept, so Back is instant. */
type Loaded = Readonly<Record<string, unknown[] | null>>

const TITLE_ID = 'site-flyout-title'

/** What a level's heading says, and the line under it. */
const headingOf = (step: Step): { title: string; subtitle: string | null } => {
  switch (step.level) {
    case 'sites':
      return { title: 'Choose a site', subtitle: 'for Pages' }
    case 'pages':
      return { title: `Pages — ${step.site.name}`, subtitle: null }
    case 'boards':
      return { title: 'Announcements', subtitle: 'Choose a board' }
    case 'posts':
      return { title: step.board.name, subtitle: step.site.name }
    case 'calendars':
      return { title: 'Events', subtitle: 'Choose a calendar' }
    case 'folders':
      return { title: 'Files', subtitle: 'Choose a folder' }
    case 'files':
      return { title: step.folder.name, subtitle: step.site.name }
  }
}

const calendarLabel = (calendar: CalendarChoice): ReactNode => (
  <>
    {calendar.name}
    {calendar.main ? <span className={styles.siteNote}> Main calendar</span> : null}
  </>
)

/** Where each panel starts. A school manager has one school, so Pages opens on its pages. */
const firstStep = (kind: PanelKind, plane: Plane, sites: readonly SiteChoice[]): Step => {
  if (kind === 'boards') return { level: 'boards' }
  if (kind === 'calendars') return { level: 'calendars' }
  if (kind === 'files') return { level: 'folders' }
  return plane === 'school' && sites.length === 1
    ? { level: 'pages', site: sites[0]! }
    : { level: 'sites' }
}

/**
 * The levels of the panel beside the menu (Jason, 2026-11-18): each one REPLACES the one before
 * it in the panel.
 * - Pages: the sites → a site's pages, each opening its form. The district's "Add or move pages"
 *   opens the site's page tree; a school manager, on their one school from the start, gets "Add a
 *   page" (the new-page task — where a page sits is the district's).
 * - Announcements: every board, site → folder → board (Jason: "a drawer with all boards") → the
 *   board's posts in their place (Jason, 2026-11-18), the newest first, each opening its form;
 *   "Create post" above them, and the announcements screen a link away.
 * - Events: every calendar, under its site's name, the main one first (Jason: "a drawer with all
 *   calendars too"), each opening its events; "Add an event" above them. An imported calendar
 *   opens a dialog instead, "This calendar is a feed from …" (`FeedCalendarDialog`; Jason,
 *   2026-11-18: not in the list itself), with its events a link away.
 * - Files: every folder, under its site's name (no clicking through a site) → a folder's files,
 *   each opening in the file library with its details showing.
 *
 * Drilling in is a BUTTON (it changes the panel); leaving is a LINK (it changes the address, so
 * Back works). The heading names the level and takes focus on each change. Each level is read
 * over REST as the user (`site-flyout.ts`) — access decides, so a school manager sees their own
 * school's — with "Loading…" in a status until it arrives. Remounted per kind by its parent.
 */
export const SiteFlyout = ({
  kind,
  plane,
  sites,
  current,
  onLeave,
  onClose,
}: {
  kind: PanelKind
  plane: Plane
  sites: readonly SiteChoice[]
  current: string | null
  /** A link inside was followed: shut the panel as the address changes. */
  onLeave: () => void
  onClose: () => void
}) => {
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const [step, setStep] = useState<Step>(() => firstStep(kind, plane, sites))
  const [loaded, setLoaded] = useState<Loaded>({})
  /** The imported calendar whose dialog is open. */
  const [feed, setFeed] = useState<CalendarChoice | null>(null)
  const closeFeed = useCallback(() => {
    const id = feed?.id
    setFeed(null)
    if (id) document.getElementById(`flyout-calendar-${id}`)?.focus()
  }, [feed])
  const heading = useRef<HTMLHeadingElement>(null)
  const onOneSite = plane === 'school' && sites.length === 1

  const urls: readonly string[] =
    step.level === 'pages'
      ? [pagesQuery(api, step.site.id)]
      : step.level === 'boards'
        ? [boardFoldersQuery(api), boardsQuery(api)]
        : step.level === 'posts'
          ? [boardPostsQuery(api, step.board.id)]
          : step.level === 'calendars'
            ? [calendarsQuery(api)]
            : step.level === 'folders'
              ? [allFoldersQuery(api)]
              : step.level === 'files'
                ? [filesQuery(api, step.site.id, step.folder.id)]
                : []
  const wanted = urls.join(' ')

  useEffect(() => {
    const missing = wanted === '' ? [] : wanted.split(' ').filter((url) => !(url in loaded))
    if (missing.length === 0) return
    let live = true
    for (const url of missing) {
      fetch(url, { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then(
          (body: { docs?: unknown[] }) =>
            live && setLoaded((l) => ({ ...l, [url]: body.docs ?? [] })),
        )
        .catch(() => live && setLoaded((l) => ({ ...l, [url]: null })))
    }
    return () => {
      live = false
    }
  }, [wanted, loaded])

  // Each level: focus its heading, so where the panel now is is what is read next.
  const key = JSON.stringify(step)
  useEffect(() => {
    heading.current?.focus()
  }, [key])

  const results = urls.map((url) => loaded[url])
  const loading = results.some((r) => r === undefined)
  const failed = results.some((r) => r === null)
  const docs = (i = 0) => (results[i] ?? []) as Row[]

  const { title, subtitle } = headingOf(step)

  const back =
    step.level === 'pages' && !onOneSite ? (
      <button
        className={styles.flyoutBack}
        onClick={() => setStep({ level: 'sites' })}
        type="button"
      >
        All sites
      </button>
    ) : step.level === 'posts' ? (
      <button
        className={styles.flyoutBack}
        onClick={() => setStep({ level: 'boards' })}
        type="button"
      >
        All boards
      </button>
    ) : step.level === 'files' ? (
      <button
        className={styles.flyoutBack}
        onClick={() => setStep({ level: 'folders' })}
        type="button"
      >
        All folders
      </button>
    ) : null

  const leave = (href: string, children: ReactNode, className = styles.site) => (
    <Link className={className} href={href} onClick={onLeave} prefetch={false}>
      {children}
    </Link>
  )

  const rows = (): ReactNode => {
    if (step.level === 'sites') {
      if (sites.length === 0) return <p className={styles.flyoutFor}>There are no sites yet.</p>
      return (
        <ul className={styles.sites}>
          {sites.map((site) => (
            <li key={site.id}>
              <button
                aria-current={current === site.id ? 'true' : undefined}
                className={`${styles.site} ${styles.siteButton}`}
                onClick={() => setStep({ level: 'pages', site })}
                type="button"
              >
                {site.name}
              </button>
            </li>
          ))}
        </ul>
      )
    }
    if (loading)
      return (
        <p className={styles.flyoutFor} role="status">
          Loading…
        </p>
      )
    if (failed)
      return (
        <p className={styles.flyoutFor} role="alert">
          This list could not be loaded. Close it and try again.
        </p>
      )

    if (step.level === 'pages') {
      const tree = pageTree(docs() as Parameters<typeof pageTree>[0])
      const list = (nodes: readonly PageNode[]): ReactNode => (
        <ul className={styles.sites}>
          {nodes.map((node) => (
            <li key={node.id}>
              {leave(
                schoolEditPath('pages', node.id),
                <>
                  {node.title}
                  <span className={styles.siteNote}> {node.labels.join(' · ')}</span>
                </>,
              )}
              {node.children.length > 0 ? (
                <div className={styles.nested}>{list(node.children)}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )
      return (
        <>
          {plane === 'district'
            ? leave(sitePagesHref({ site: step.site.id }), 'Add or move pages', styles.flyoutAction)
            : leave('/admin/new-page', 'Add a page', styles.flyoutAction)}
          {tree.length === 0 ? (
            <p className={styles.flyoutFor}>This site has no pages yet.</p>
          ) : (
            list(tree)
          )}
        </>
      )
    }

    if (step.level === 'boards') {
      const tree = boardsBySite(docs(0), docs(1), sites)
      return tree.length === 0 ? (
        <p className={styles.flyoutFor}>There are no announcement boards yet.</p>
      ) : (
        tree.map((site) => (
          <section
            aria-labelledby={`flyout-site-${site.id}`}
            className={styles.group}
            key={site.id}
          >
            <h3 className={styles.groupTitle} id={`flyout-site-${site.id}`}>
              {site.name}
            </h3>
            {site.folders.map((folder) => (
              <div key={folder.id}>
                <p className={styles.groupFolder}>{folder.name}</p>
                <ul className={`${styles.sites} ${styles.nested}`}>
                  {folder.boards.map((board) => (
                    <li key={board.id}>
                      <button
                        className={`${styles.site} ${styles.siteButton}`}
                        onClick={() =>
                          setStep({
                            level: 'posts',
                            site: { id: site.id, name: site.name },
                            board: { id: board.id, name: board.name },
                          })
                        }
                        type="button"
                      >
                        {board.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))
      )
    }

    if (step.level === 'posts') {
      const posts = docs() as PostRow[]
      return (
        <>
          {leave(createPostHref(step.board.id), 'Create post', styles.flyoutAction)}
          {posts.length === 0 ? (
            <p className={styles.flyoutFor}>There are no posts on this board yet.</p>
          ) : (
            <ul className={styles.sites}>
              {posts.map((post) => (
                <li key={String(post.id)}>
                  {leave(
                    schoolEditPath('posts', String(post.id)),
                    <>
                      {post.title?.trim() || 'Untitled post'}
                      <span className={styles.siteNote}> {pageStatusLabels(post).join(' · ')}</span>
                    </>,
                  )}
                </li>
              ))}
            </ul>
          )}
          {leave(
            boardHref(step.board.id),
            posts.length >= BOARD_POSTS_SHOWN
              ? 'See all on the announcements screen'
              : 'Open on the announcements screen',
            styles.flyoutMore,
          )}
        </>
      )
    }

    if (step.level === 'calendars') {
      const groups = calendarsBySite(docs(), sites)
      return (
        <>
          {plane === 'district'
            ? leave('/admin/collections/events/create', 'Add an event', styles.flyoutAction)
            : leave('/admin/new-event', 'Add an event', styles.flyoutAction)}
          {groups.length === 0 ? (
            <p className={styles.flyoutFor}>There are no calendars yet.</p>
          ) : (
            groups.map(({ site, calendars }) => (
              <section
                aria-labelledby={`flyout-site-${site.id}`}
                className={styles.group}
                key={site.id}
              >
                <h3 className={styles.groupTitle} id={`flyout-site-${site.id}`}>
                  {site.name}
                </h3>
                <ul className={styles.sites}>
                  {calendars.map((calendar) => (
                    <li key={calendar.id}>
                      {calendar.feed === null ? (
                        leave(calendarEventsHref(calendar.id), calendarLabel(calendar))
                      ) : (
                        // Imported: say so in a dialog once chosen (Jason, 2026-11-18).
                        <button
                          aria-haspopup="dialog"
                          className={`${styles.site} ${styles.siteButton}`}
                          id={`flyout-calendar-${calendar.id}`}
                          onClick={() => setFeed(calendar)}
                          type="button"
                        >
                          {calendarLabel(calendar)}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )
    }

    if (step.level === 'folders') {
      const groups = foldersBySite(docs() as Parameters<typeof foldersBySite>[0], sites)
      const list = (site: Named, nodes: readonly FolderNode[]): ReactNode => (
        <ul className={styles.sites}>
          {nodes.map((node) => (
            <li key={node.id}>
              <button
                className={`${styles.site} ${styles.siteButton}`}
                onClick={() =>
                  setStep({ level: 'files', site, folder: { id: node.id, name: node.name } })
                }
                type="button"
              >
                {node.name}
              </button>
              {node.children.length > 0 ? (
                <div className={styles.nested}>{list(site, node.children)}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )
      return groups.length === 0 ? (
        <p className={styles.flyoutFor}>There are no folders yet.</p>
      ) : (
        groups.map(({ site, folders }) => (
          <section
            aria-labelledby={`flyout-site-${site.id}`}
            className={styles.group}
            key={site.id}
          >
            <h3 className={styles.groupTitle} id={`flyout-site-${site.id}`}>
              {site.name}
            </h3>
            {list(site, folders)}
          </section>
        ))
      )
    }

    const files = docs() as FileRow[]
    return files.length === 0 ? (
      <p className={styles.flyoutFor}>There are no files in this folder.</p>
    ) : (
      <ul className={styles.sites}>
        {files.map((file) => (
          <li key={String(file.id)}>
            {leave(
              fileHref(step.site.id, step.folder.id, String(file.id)),
              <>
                {file.title?.trim() || 'Untitled file'}
                {file.kind ? (
                  <span className={styles.siteNote}>
                    {' '}
                    {file.kind === 'image' ? 'Image' : 'Document'}
                  </span>
                ) : null}
              </>,
            )}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <div className={styles.flyoutHeader}>
        <h2 className={styles.flyoutTitle} id={TITLE_ID} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        {subtitle ? <p className={styles.flyoutFor}>{subtitle}</p> : null}
        <button className={styles.flyoutClose} onClick={onClose} type="button">
          Close
        </button>
      </div>
      {back}
      {rows()}
      {feed?.feed ? (
        <FeedCalendarDialog
          eventsHref={calendarEventsHref(feed.id)}
          name={feed.name}
          note={feed.feed}
          onClosed={closeFeed}
          onLeave={onLeave}
        />
      ) : null}
    </>
  )
}
