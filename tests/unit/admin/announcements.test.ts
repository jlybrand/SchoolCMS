import { describe, expect, it } from 'vitest'

import {
  announcementStatus,
  boardFromQuery,
  boardHref,
  createPostHref,
  findBoard,
  soleBoard,
  wantsNewPost,
} from '@/admin/Announcements/announcements'
import type { SiteNode } from '@/admin/Boards/board-tree'

/**
 * The announcements screen (Jason, 2026-11-04): Finalsite's Posts module — a site's folders, a
 * folder's boards, a board's posts, and "Create post" at the top right starting a post on that
 * board. The pure decisions under it. The screen itself is custom admin React, locked by
 * `tests/e2e/announcements.spec.ts` per CLAUDE.md's exception table.
 */

const tree: SiteNode[] = [
  {
    id: '1',
    name: 'District',
    folders: [{ id: '10', name: 'News', boards: [{ id: '100', name: 'Superintendent' }] }],
  },
  {
    id: '2',
    name: 'School A',
    folders: [
      {
        id: '20',
        name: 'Athletics',
        boards: [
          { id: '200', name: 'Fall sports' },
          { id: '201', name: 'Spring sports' },
        ],
      },
      { id: '21', name: 'Main office', boards: [] },
    ],
  },
]

describe('boardFromQuery — the board named in the address', () => {
  it('reads one numeric id', () => {
    expect(boardFromQuery({ board: '200' })).toBe('200')
  })

  it('refuses anything else, so nothing odd reaches a query', () => {
    expect(boardFromQuery({})).toBeNull()
    expect(boardFromQuery(undefined)).toBeNull()
    expect(boardFromQuery(null)).toBeNull()
    expect(boardFromQuery({ board: '' })).toBeNull()
    expect(boardFromQuery({ board: 'abc' })).toBeNull()
    expect(boardFromQuery({ board: '12; drop' })).toBeNull()
    expect(boardFromQuery({ board: ['1', '2'] })).toBeNull()
    expect(boardFromQuery({ board: { in: ['1'] } })).toBeNull()
  })
})

describe('boardHref / createPostHref — where the screen links', () => {
  it('opens a board on the announcements screen', () => {
    expect(boardHref('200')).toBe('/admin/collections/posts?board=200')
  })

  it('creates a post on the same screen: the board, with the headline showing', () => {
    expect(createPostHref('200')).toBe('/admin/collections/posts?board=200&new=1')
  })
})

describe('wantsNewPost — is the headline showing?', () => {
  it('is on only for new=1', () => {
    expect(wantsNewPost({ new: '1' })).toBe(true)
    expect(wantsNewPost({ board: '200', new: '1' })).toBe(true)
    expect(wantsNewPost({})).toBe(false)
    expect(wantsNewPost({ new: 'yes' })).toBe(false)
    expect(wantsNewPost({ new: ['1'] })).toBe(false)
    expect(wantsNewPost(undefined)).toBe(false)
  })
})

describe('findBoard — the chosen board, with its site and folder', () => {
  it('finds a board anywhere in the tree', () => {
    expect(findBoard(tree, '201')).toEqual({
      site: 'School A',
      folder: 'Athletics',
      board: 'Spring sports',
      folderId: '20',
    })
  })

  it('is null for a board not in the tree — one the viewer cannot read', () => {
    expect(findBoard(tree, '999')).toBeNull()
    expect(findBoard(tree, null)).toBeNull()
  })
})

describe('soleBoard — opening straight onto the only board', () => {
  it('is that board when the viewer has exactly one', () => {
    expect(
      soleBoard([
        {
          id: '2',
          name: 'School A',
          folders: [{ id: '20', name: 'News', boards: [{ id: '200', name: 'General' }] }],
        },
      ]),
    ).toBe('200')
  })

  it('is null with several, or none', () => {
    expect(soleBoard(tree)).toBeNull()
    expect(soleBoard([])).toBeNull()
  })
})

describe('announcementStatus — one word for where a post stands', () => {
  it('tells the district the publishing state', () => {
    expect(announcementStatus({ _status: 'published' }, 'district')).toBe('Published')
    expect(announcementStatus({ _status: 'draft' }, 'district')).toBe('Draft')
    expect(announcementStatus({ reviewState: 'submitted' }, 'district')).toBe(
      'Waiting for approval',
    )
    expect(announcementStatus({ reviewState: 'changes-requested' }, 'district')).toBe('Sent back')
  })

  it('puts a waiting change ahead of a published version', () => {
    expect(announcementStatus({ _status: 'published', reviewState: 'submitted' }, 'district')).toBe(
      'Waiting for approval',
    )
  })

  it('tells a school in their words — never draft or publish (`04` §2.1)', () => {
    expect(announcementStatus({ _status: 'published' }, 'school')).toBe('On the website')
    expect(announcementStatus({ _status: 'draft' }, 'school')).toBe('Not sent yet')
    expect(announcementStatus({ reviewState: 'submitted' }, 'school')).toBe('Sent for approval')
    expect(announcementStatus({ reviewState: 'changes-requested' }, 'school')).toBe('Needs changes')
    for (const doc of [{ _status: 'published' }, { _status: 'draft' }, {}]) {
      expect(announcementStatus(doc, 'school').toLowerCase()).not.toMatch(/draft|publish/)
    }
  })
})
