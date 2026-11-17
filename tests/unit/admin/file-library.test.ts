import { describe, expect, it } from 'vitest'

import {
  checkDetails,
  folderTree,
  libraryHref,
  libraryParams,
  type LibraryParams,
} from '@/admin/Resources/file-library'

/**
 * The file library screen's rules (Jason, 2026-11-17) — PURE. The screen is rendered from its
 * address, so these decide what an address means, how a link changes it, how the folder tree
 * nests, and what the details form sends.
 */

describe('libraryParams — what an address means', () => {
  it('nothing asked: no site, all files, page 1', () => {
    expect(libraryParams({})).toEqual({
      site: null,
      folder: 'all',
      q: '',
      kind: null,
      page: 1,
      file: null,
    })
  })

  it('everything asked', () => {
    expect(
      libraryParams({
        site: '3',
        folder: '12',
        q: '  lunch menu ',
        kind: 'document',
        page: '2',
        file: '40',
      }),
    ).toEqual({ site: '3', folder: '12', q: 'lunch menu', kind: 'document', page: 2, file: '40' })
  })

  it.each([
    ['site', { site: '3 OR 1=1' }, { site: null }],
    ['site', { site: '-1' }, { site: null }],
    ['folder', { folder: 'x' }, { folder: 'all' }],
    ['file', { file: '4e2' }, { file: null }],
    ['kind', { kind: 'video' }, { kind: null }],
    ['page', { page: '0' }, { page: 1 }],
    ['page', { page: 'abc' }, { page: 1 }],
    ['page', { page: '999999' }, { page: 1000 }],
  ])('a malformed %s is refused, not trusted', (_name, raw, expected) => {
    expect(libraryParams(raw)).toMatchObject(expected)
  })

  it('a repeated parameter uses the first', () => {
    expect(libraryParams({ site: ['3', '4'] })).toMatchObject({ site: '3' })
  })

  it('a long search is cut to 100 characters', () => {
    expect(libraryParams({ q: 'a'.repeat(300) }).q).toHaveLength(100)
  })
})

describe('libraryHref — a link that changes one thing', () => {
  const at: LibraryParams = {
    site: '3',
    folder: '12',
    q: 'menu',
    kind: 'image',
    page: 2,
    file: '40',
  }

  it('opening a file keeps where you are', () => {
    expect(libraryHref(at, { file: '41' })).toBe(
      '/admin/file-library?site=3&folder=12&q=menu&kind=image&page=2&file=41',
    )
  })

  it('a new folder starts at page 1 and closes the file', () => {
    expect(libraryHref(at, { folder: '13' })).toBe(
      '/admin/file-library?site=3&folder=13&q=menu&kind=image',
    )
  })

  it('a new site starts over', () => {
    expect(libraryHref(at, { site: '4' })).toBe('/admin/file-library?site=4')
  })

  it('a new page closes the file', () => {
    expect(libraryHref(at, { page: 3 })).toBe(
      '/admin/file-library?site=3&folder=12&q=menu&kind=image&page=3',
    )
  })

  it('closing the file', () => {
    expect(libraryHref(at, { file: null })).toBe(
      '/admin/file-library?site=3&folder=12&q=menu&kind=image&page=2',
    )
  })

  it('defaults are left out', () => {
    expect(libraryHref({ ...at, folder: 'all', q: '', kind: null, page: 1, file: null }, {})).toBe(
      '/admin/file-library?site=3',
    )
  })
})

describe('folderTree — the folders, nested', () => {
  it('top-level folders A–Z, each with its folders inside, A–Z', () => {
    expect(
      folderTree([
        { id: 1, name: 'Menus', parent: null },
        { id: 2, name: 'Forms', parent: null },
        { id: 3, name: 'Enrollment', parent: 2 },
        { id: 4, name: 'Athletics', parent: { id: 2 } },
        { id: 5, name: '2026', parent: 3 },
      ]),
    ).toEqual([
      {
        id: '2',
        name: 'Forms',
        children: [
          { id: '4', name: 'Athletics', children: [] },
          { id: '3', name: 'Enrollment', children: [{ id: '5', name: '2026', children: [] }] },
        ],
      },
      { id: '1', name: 'Menus', children: [] },
    ])
  })

  it('a folder whose parent isn’t there sits at the top, never lost', () => {
    expect(folderTree([{ id: 7, name: 'Stray', parent: 99 }])).toEqual([
      { id: '7', name: 'Stray', children: [] },
    ])
  })

  it('a cycle in bad data neither hangs nor drops the folders', () => {
    const tree = folderTree([
      { id: 1, name: 'A', parent: 2 },
      { id: 2, name: 'B', parent: 1 },
    ])
    const ids = (nodes: typeof tree): string[] => nodes.flatMap((n) => [n.id, ...ids(n.children)])
    expect(ids(tree).sort()).toEqual(['1', '2'])
  })
})

describe('checkDetails — the details form', () => {
  it('an image: title, description, tags and its description', () => {
    expect(
      checkDetails({
        kind: 'image',
        title: ' Fair ',
        description: ' The fair ',
        tagsText: 'events, fair',
        alt: ' Students ',
        isDecorative: false,
      }),
    ).toEqual({
      ok: true,
      data: {
        title: 'Fair',
        description: 'The fair',
        tagsText: 'events, fair',
        alt: 'Students',
        isDecorative: false,
      },
    })
  })

  it('emptied description and tags are sent empty, so they clear', () => {
    const check = checkDetails({
      kind: 'document',
      title: 'Menu',
      description: '',
      tagsText: ' ',
    })
    expect(check).toEqual({ ok: true, data: { title: 'Menu', description: '', tagsText: '' } })
  })

  it('a decorative image sends no description', () => {
    expect(
      checkDetails({ kind: 'image', title: 'Border', alt: '', isDecorative: true }),
    ).toMatchObject({ ok: true, data: { isDecorative: true } })
  })

  it('no title, and an image with no description: both said, in the library’s words', () => {
    expect(checkDetails({ kind: 'image', title: ' ', alt: '', isDecorative: false })).toEqual({
      ok: false,
      errors: {
        title: 'Give the file a title.',
        alt: 'Describe the image for people who can’t see it, or mark it decorative.',
      },
    })
  })

  it('a document never asks for a description of an image', () => {
    expect(checkDetails({ kind: 'document', title: 'Menu' })).toMatchObject({ ok: true })
  })
})
