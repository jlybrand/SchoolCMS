import { describe, expect, it } from 'vitest'

import { findFileUses, usesSummary, type FileUsesInput } from '@/lib/file-uses'

/**
 * Where a library file is used (Jason, 2026-11-17) — worked out from its own site's PUBLISHED
 * pages and announcements, never stored. A library file can be used only by its own site
 * (`libraryImageField`), so the inputs are that site's rows; the caller passes published ones
 * only. Pure.
 */

const SCHOOL_A = '2'
const SCHOOL_B = '3'
const SCHOOL_C = '4'
const DISTRICT = '1'

const names = new Map([
  [DISTRICT, 'District'],
  [SCHOOL_A, 'School A'],
  [SCHOOL_B, 'School B'],
  [SCHOOL_C, 'School C'],
])
const all = [DISTRICT, SCHOOL_A, SCHOOL_B, SCHOOL_C]

const image = { id: 50, tenant: SCHOOL_A, kind: 'image' as const, folder: 7 }
const document = { id: 60, tenant: SCHOOL_A, kind: 'document' as const, folder: 7 }

const page = (
  id: number,
  title: string,
  layout: unknown[],
  extra: Partial<{ slug: string; parent: number | null; visibility: string }> = {},
) => ({
  id,
  title,
  slug: extra.slug ?? title.toLowerCase().replace(/\s+/g, '-'),
  parent: extra.parent ?? null,
  visibility: extra.visibility ?? 'public',
  layout,
})

const input = (over: Partial<FileUsesInput>): FileUsesInput => ({
  file: image,
  pages: [],
  posts: [],
  reusers: [],
  siteNames: names,
  allTenantIds: all,
  ...over,
})

describe('pages', () => {
  it('an Image section and a Hero section, each found, with the page’s address', () => {
    const uses = findFileUses(
      input({
        pages: [
          page(1, 'About', [{ blockType: 'image', image: 50 }]),
          page(2, 'Fair', [{ blockType: 'hero', image: { id: 50 } }], { parent: 1 }),
          page(3, 'Other', [{ blockType: 'image', image: 51 }]),
        ],
      }),
    )
    expect(uses.pages).toEqual([
      { id: 1, title: 'About', path: '/about', via: ['image'], staffOnly: false },
      { id: 2, title: 'Fair', path: '/about/fair', via: ['hero'], staffOnly: false },
    ])
  })

  it('inside Columns, and both kinds on one page, listed once', () => {
    const uses = findFileUses(
      input({
        pages: [
          page(
            1,
            'Home',
            [
              { blockType: 'hero', image: 50 },
              {
                blockType: 'columns',
                columns: [
                  { content: [{ blockType: 'richText' }] },
                  { content: [{ blockType: 'image', image: 50 }] },
                ],
              },
              { blockType: 'image', image: 50 },
            ],
            { slug: 'home' },
          ),
        ],
      }),
    )
    expect(uses.pages).toEqual([
      { id: 1, title: 'Home', path: '/', via: ['hero', 'image'], staffOnly: false },
    ])
  })

  it('a staff-only page counts, and says so', () => {
    const uses = findFileUses(
      input({
        pages: [page(1, 'Staff', [{ blockType: 'image', image: 50 }], { visibility: 'staff' })],
      }),
    )
    expect(uses.pages[0]).toMatchObject({ staffOnly: true })
  })

  it('a page under a parent that isn’t published has no address, but is still listed', () => {
    const uses = findFileUses(
      input({ pages: [page(2, 'Orphan', [{ blockType: 'image', image: 50 }], { parent: 99 })] }),
    )
    expect(uses.pages).toEqual([
      { id: 2, title: 'Orphan', path: null, via: ['image'], staffOnly: false },
    ])
  })

  it('by title, A–Z', () => {
    const uses = findFileUses(
      input({
        pages: [
          page(1, 'Zoo', [{ blockType: 'image', image: 50 }]),
          page(2, 'Art', [{ blockType: 'image', image: 50 }]),
        ],
      }),
    )
    expect(uses.pages.map((p) => p.title)).toEqual(['Art', 'Zoo'])
  })

  it('malformed layouts are ignored, not thrown on', () => {
    const uses = findFileUses(
      input({
        pages: [
          page(1, 'Odd', [null, 'x', { blockType: 'columns', columns: 'nope' }, { image: 50 }]),
        ],
      }),
    )
    expect(uses.pages).toEqual([])
  })
})

describe('document lists — a whole folder', () => {
  it('a document in the listed folder is used by that list', () => {
    const uses = findFileUses(
      input({
        file: document,
        pages: [
          page(1, 'Forms', [{ blockType: 'documentList', folder: 7 }]),
          page(2, 'Menus', [
            {
              blockType: 'columns',
              columns: [{ content: [{ blockType: 'documentList', folder: { id: 7 } }] }],
            },
          ]),
          page(3, 'Other', [{ blockType: 'documentList', folder: 8 }]),
        ],
      }),
    )
    expect(uses.pages.map((p) => [p.title, p.via])).toEqual([
      ['Forms', ['document list']],
      ['Menus', ['document list']],
    ])
  })

  it('an image is never “used” by a document list, though it sits in the folder', () => {
    const uses = findFileUses(
      input({ pages: [page(1, 'Forms', [{ blockType: 'documentList', folder: 7 }])] }),
    )
    expect(uses.pages).toEqual([])
  })

  it('a document in no folder is used by no list', () => {
    const uses = findFileUses(
      input({
        file: { ...document, folder: null },
        pages: [page(1, 'Forms', [{ blockType: 'documentList', folder: null }])],
      }),
    )
    expect(uses.pages).toEqual([])
  })
})

describe('announcements', () => {
  it('its own site only', () => {
    const uses = findFileUses(
      input({
        posts: [{ id: 9, title: 'Fair news', tenant: SCHOOL_A, syndication: { scope: 'own' } }],
      }),
    )
    expect(uses.announcements).toEqual([{ id: 9, title: 'Fair news', alsoOn: [] }])
  })

  it('shared with chosen schools: those sites, by name', () => {
    const uses = findFileUses(
      input({
        posts: [
          {
            id: 9,
            title: 'Fair news',
            tenant: SCHOOL_A,
            syndication: { scope: 'selected', syndicatedTo: [SCHOOL_C, { id: SCHOOL_B }] },
          },
        ],
      }),
    )
    expect(uses.announcements[0]?.alsoOn).toEqual(['School B', 'School C'])
  })

  it('shared district-wide: every other site', () => {
    const uses = findFileUses(
      input({
        posts: [
          { id: 9, title: 'News', tenant: SCHOOL_A, syndication: { scope: 'district-wide' } },
        ],
      }),
    )
    expect(uses.announcements[0]?.alsoOn).toEqual(['District', 'School B', 'School C'])
  })
})

describe('linked pages — a district page’s content shown on another site', () => {
  const districtImage = { id: 70, tenant: DISTRICT, kind: 'image' as const, folder: null }

  it('a page reusing a page that uses the file is listed with its site', () => {
    const uses = findFileUses(
      input({
        file: districtImage,
        pages: [page(1, 'Calendar', [{ blockType: 'image', image: 70 }])],
        reusers: [
          { id: 20, title: 'Calendar', tenant: SCHOOL_B, districtLinkTarget: 1 },
          { id: 21, title: 'Other', tenant: SCHOOL_C, districtLinkTarget: 5 },
        ],
      }),
    )
    expect(uses.linked).toEqual([{ id: 20, title: 'Calendar', site: 'School B' }])
  })
})

describe('nothing', () => {
  it('an unused file has no uses', () => {
    expect(findFileUses(input({}))).toEqual({ pages: [], announcements: [], linked: [] })
  })
})

describe('usesSummary — one line, for the replace form', () => {
  const uses = (pages: number, announcements: number, linked = 0) => ({
    pages: Array.from({ length: pages }, (_, i) => ({
      id: i,
      title: 'P',
      path: null,
      via: ['image' as const],
      staffOnly: false,
    })),
    announcements: Array.from({ length: announcements }, (_, i) => ({
      id: i,
      title: 'A',
      alsoOn: [],
    })),
    linked: Array.from({ length: linked }, (_, i) => ({ id: i, title: 'L', site: 'S' })),
  })

  it.each([
    [0, 0, 0, 'Not used on any published page or announcement.'],
    [1, 0, 0, 'Used on 1 page.'],
    [3, 0, 0, 'Used on 3 pages.'],
    [0, 1, 0, 'Used on 1 announcement.'],
    [3, 2, 0, 'Used on 3 pages and 2 announcements.'],
    [1, 0, 2, 'Used on 3 pages.'],
  ])('%i pages, %i announcements, %i linked → %s', (p, a, l, text) => {
    expect(usesSummary(uses(p, a, l))).toBe(text)
  })
})
