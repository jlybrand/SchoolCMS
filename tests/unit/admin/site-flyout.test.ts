import { describe, expect, it } from 'vitest'

import {
  allFoldersQuery,
  calendarEventsHref,
  calendarsBySite,
  calendarsQuery,
  boardFoldersQuery,
  boardsBySite,
  boardsQuery,
  fileHref,
  filesQuery,
  foldersBySite,
  pagesQuery,
} from '@/admin/Nav/site-flyout'

/**
 * The "Choose a site" panel's drill-down (Jason, 2026-11-18) — PURE: what each level asks the
 * REST API for, and where a file leads. Pages: sites → the site's pages. Files: sites → the site's
 * folders → a folder's files.
 */

const params = (query: string) => Object.fromEntries(new URLSearchParams(query.split('?')[1]))

describe('pagesQuery — a site’s pages, drafts too, only what the list shows', () => {
  it('asks for one site, every page, unpaged, unpopulated', () => {
    const q = pagesQuery('/api', '3')
    expect(q.startsWith('/api/pages?')).toBe(true)
    expect(params(q)).toEqual({
      'where[tenant][equals]': '3',
      draft: 'true',
      depth: '0',
      pagination: 'false',
      'select[title]': 'true',
      'select[slug]': 'true',
      'select[parent]': 'true',
      'select[_status]': 'true',
      'select[reviewState]': 'true',
    })
  })
})

describe('allFoldersQuery — Files opens on every folder (Jason, 2026-11-18)', () => {
  it('every site’s folders, with the site each is on', () => {
    const q = allFoldersQuery('/api')
    expect(q.startsWith('/api/resource-folders?')).toBe(true)
    expect(params(q)).toEqual({
      depth: '0',
      pagination: 'false',
      'select[name]': 'true',
      'select[parent]': 'true',
      'select[tenant]': 'true',
    })
  })
})

describe('foldersBySite — the folders under each site’s name', () => {
  const sites = [
    { id: '9', name: 'DD2 District' },
    { id: '1', name: 'Adams Middle' },
    { id: '3', name: 'Washington Elementary' },
  ]

  it('in the sites’ order, each nested, a site with none left out', () => {
    const groups = foldersBySite(
      [
        { id: 20, name: 'Menus', tenant: 3, parent: null },
        { id: 21, name: 'Lunch', tenant: 3, parent: 20 },
        { id: 22, name: 'Board', tenant: 9, parent: null },
        { id: 23, name: 'Forms', tenant: { id: 9 }, parent: null },
      ],
      sites,
    )
    expect(
      groups.map((g) => [
        g.site.name,
        g.folders.map((f) => [f.name, f.children.map((c) => c.name)]),
      ]),
    ).toEqual([
      [
        'DD2 District',
        [
          ['Board', []],
          ['Forms', []],
        ],
      ],
      ['Washington Elementary', [['Menus', ['Lunch']]]],
    ])
  })

  it('a folder on a site not in the list is not shown', () => {
    expect(foldersBySite([{ id: 1, name: 'Stray', tenant: 77, parent: null }], sites)).toEqual([])
  })
})

describe('filesQuery', () => {
  it('one folder’s files on one site, by title', () => {
    const q = filesQuery('/api', '3', '12')
    expect(q.startsWith('/api/resources?')).toBe(true)
    expect(params(q)).toEqual({
      'where[and][0][tenant][equals]': '3',
      'where[and][1][folder][equals]': '12',
      depth: '0',
      pagination: 'false',
      sort: 'title',
      'select[title]': 'true',
      'select[kind]': 'true',
    })
  })
})

describe('fileHref — a file opens in the library, in its folder, its details showing', () => {
  it('site, folder and file', () => {
    expect(fileHref('3', '12', '40')).toBe('/admin/file-library?site=3&folder=12&file=40')
  })
})

describe('the boards — Announcements opens on every board (Jason, 2026-11-18)', () => {
  it('asks for every board folder and every board, with their sites', () => {
    expect(params(boardFoldersQuery('/api'))).toEqual({
      depth: '0',
      pagination: 'false',
      'select[name]': 'true',
      'select[tenant]': 'true',
    })
    expect(boardFoldersQuery('/api').startsWith('/api/post-folders?')).toBe(true)
    expect(params(boardsQuery('/api'))).toEqual({
      depth: '0',
      pagination: 'false',
      'select[name]': 'true',
      'select[folder]': 'true',
      'select[tenant]': 'true',
    })
    expect(boardsQuery('/api').startsWith('/api/post-boards?')).toBe(true)
  })

  it('site → folder → board, in the sites’ order, a site with no boards left out', () => {
    const sites = [
      { id: '9', name: 'DD2 District' },
      { id: '1', name: 'Adams Middle' },
      { id: '3', name: 'Washington Elementary' },
    ]
    const tree = boardsBySite(
      [
        { id: 30, name: 'Washington Elementary', tenant: 3 },
        { id: 31, name: 'District news', tenant: 9 },
        { id: 32, name: 'Empty folder', tenant: 1 },
      ],
      [
        { id: 40, name: 'News', folder: 30 },
        { id: 41, name: 'PTA', folder: 30 },
        { id: 42, name: 'Superintendent', folder: 31 },
      ],
      sites,
    )
    expect(
      tree.map((s) => [s.name, s.folders.map((f) => [f.name, f.boards.map((b) => b.name)])]),
    ).toEqual([
      ['DD2 District', [['District news', ['Superintendent']]]],
      ['Washington Elementary', [['Washington Elementary', ['News', 'PTA']]]],
    ])
  })
})

describe('the calendars — Events opens on every calendar (Jason, 2026-11-18)', () => {
  it('asks for every calendar, with its site and whether it is the main one', () => {
    const q = calendarsQuery('/api')
    expect(q.startsWith('/api/calendars?')).toBe(true)
    expect(params(q)).toEqual({
      depth: '0',
      pagination: 'false',
      'select[name]': 'true',
      'select[isMain]': 'true',
      'select[tenant]': 'true',
      'select[source]': 'true',
      'select[feedUrl]': 'true',
    })
  })

  it('under each site, in the sites’ order; the main calendar first, then A–Z', () => {
    const sites = [
      { id: '9', name: 'DD2 District' },
      { id: '1', name: 'Adams Middle' },
      { id: '3', name: 'Washington Elementary' },
    ]
    const groups = calendarsBySite(
      [
        {
          id: 50,
          name: 'Sports',
          tenant: 3,
          isMain: false,
          source: 'feed',
          feedUrl: 'https://calendar.google.com/calendar/ical/x/public/basic.ics',
        },
        { id: 51, name: 'Washington calendar', tenant: 3, isMain: true },
        { id: 52, name: 'Arts', tenant: 3, isMain: false },
        { id: 53, name: 'Board meetings', tenant: { id: 9 }, isMain: false },
        { id: 54, name: 'Stray', tenant: 77, isMain: true },
      ],
      sites,
    )
    expect(groups.map((g) => [g.site.name, g.calendars.map((c) => c.name)])).toEqual([
      ['DD2 District', ['Board meetings']],
      ['Washington Elementary', ['Washington calendar', 'Arts', 'Sports']],
    ])
    expect(groups[1]!.calendars[0]).toEqual({
      id: '51',
      name: 'Washington calendar',
      main: true,
      feed: null,
    })
    // An imported calendar says where its events come from (Jason, 2026-11-18).
    expect(groups[1]!.calendars[2]).toMatchObject({
      name: 'Sports',
      feed: 'This calendar is a feed from Google Calendar. Its events are added there, not here.',
    })
  })

  it('a calendar opens its events', () => {
    expect(calendarEventsHref('51')).toBe(
      '/admin/collections/events?where%5Bcalendar%5D%5Bequals%5D=51',
    )
  })
})
