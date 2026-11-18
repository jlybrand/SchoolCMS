import { describe, expect, it } from 'vitest'

import {
  pageStatusLabels,
  pageTree,
  sitePagesHref,
  siteChoices,
  sitePagesParams,
  type PageRow,
} from '@/admin/SitePages/site-pages'

/**
 * A site's pages, as the district sees them (Jason, 2026-11-18) — PURE. The screen
 * (`/admin/site-pages`) is rendered from its address; these say what an address means, how the
 * pages nest, and what each row says about itself.
 */

const row = (
  id: number,
  title: string,
  parent: number | null = null,
  extra: Partial<PageRow> = {},
) => ({ id, title, slug: title.toLowerCase(), parent, _status: 'published', ...extra }) as PageRow

const shape = (nodes: ReturnType<typeof pageTree>): unknown =>
  nodes.map((n) => (n.children.length ? [n.title, shape(n.children)] : n.title))

describe('sitePagesParams — what an address means', () => {
  it('nothing asked', () => {
    expect(sitePagesParams({})).toEqual({ site: null, new: null })
  })

  it('a site, and a new page under another', () => {
    expect(sitePagesParams({ site: '3', new: '41' })).toEqual({ site: '3', new: '41' })
  })

  it('a new top-level page', () => {
    expect(sitePagesParams({ site: '3', new: 'top' })).toEqual({ site: '3', new: 'top' })
  })

  it('ignores what is not an id', () => {
    expect(sitePagesParams({ site: 'x', new: '1; drop' })).toEqual({ site: null, new: null })
  })

  it('takes the first of a repeated value', () => {
    expect(sitePagesParams({ site: ['4', '5'] })).toEqual({ site: '4', new: null })
  })
})

describe('sitePagesHref', () => {
  it('a site', () => {
    expect(sitePagesHref({ site: '3' })).toBe('/admin/site-pages?site=3')
  })

  it('a new page, anchored at the form', () => {
    expect(sitePagesHref({ site: '3', new: '41' })).toBe('/admin/site-pages?site=3&new=41#new-page')
  })

  it('no site', () => {
    expect(sitePagesHref({})).toBe('/admin/site-pages')
  })
})

describe('pageTree — how the pages nest', () => {
  it('nests children under their parent, A–Z at every level', () => {
    const tree = pageTree([
      row(1, 'Families'),
      row(2, 'About'),
      row(3, 'Staff', 2),
      row(4, 'Bell schedule', 2),
      row(5, 'Lunch', 1),
    ])
    expect(shape(tree)).toEqual([
      ['About', ['Bell schedule', 'Staff']],
      ['Families', ['Lunch']],
    ])
  })

  it('puts the front page first, and marks it', () => {
    const tree = pageTree([row(1, 'About'), row(2, 'Welcome', null, { slug: 'home' })])
    expect(tree.map((n) => [n.title, n.frontPage])).toEqual([
      ['Welcome', true],
      ['About', false],
    ])
  })

  it('accepts a populated parent', () => {
    const tree = pageTree([row(1, 'About'), { ...row(2, 'Staff'), parent: { id: 1 } }])
    expect(shape(tree)).toEqual([['About', ['Staff']]])
  })

  it('a page whose parent is not listed goes to the top and is marked, never lost', () => {
    const tree = pageTree([row(1, 'About'), row(2, 'Staff', 99)])
    expect(tree.map((n) => [n.title, n.orphan])).toEqual([
      ['About', false],
      ['Staff', true],
    ])
  })

  it('a parent cycle terminates, and every page still appears once', () => {
    const tree = pageTree([row(1, 'A', 2), row(2, 'B', 1), row(3, 'C')])
    const all: string[] = []
    const walk = (nodes: ReturnType<typeof pageTree>) =>
      nodes.forEach((n) => {
        all.push(n.title)
        walk(n.children)
      })
    walk(tree)
    expect(all.sort()).toEqual(['A', 'B', 'C'])
  })

  it('an untitled page is still listed', () => {
    const tree = pageTree([row(1, '')])
    expect(tree[0]?.title).toBe('Untitled page')
  })

  it('ids are strings', () => {
    expect(pageTree([row(7, 'About')])[0]?.id).toBe('7')
  })
})

describe('pageStatusLabels — what a row says about itself', () => {
  it('a live page', () => {
    expect(pageStatusLabels({ _status: 'published' })).toEqual(['Live'])
  })

  it('a page never made live', () => {
    expect(pageStatusLabels({ _status: 'draft' })).toEqual(['Not live yet'])
  })

  it('a live page with changes waiting', () => {
    expect(pageStatusLabels({ _status: 'published', reviewState: 'submitted' })).toEqual([
      'Live',
      'Sent for approval',
    ])
  })

  it('changes asked for', () => {
    expect(pageStatusLabels({ _status: 'draft', reviewState: 'changes-requested' })).toEqual([
      'Not live yet',
      'Needs changes',
    ])
  })
})

describe('siteChoices — the drawer’s list', () => {
  it('the district first, then the schools A–Z, ids as strings', () => {
    expect(
      siteChoices([
        { id: 3, name: 'Washington Elementary', type: 'school' },
        { id: 1, name: 'Adams Middle', type: 'school' },
        { id: 9, name: 'District Office', type: 'district' },
      ]),
    ).toEqual([
      { id: '9', name: 'District Office' },
      { id: '1', name: 'Adams Middle' },
      { id: '3', name: 'Washington Elementary' },
    ])
  })

  it('a site with no name is still listed', () => {
    expect(siteChoices([{ id: 4, name: null, type: 'school' }])).toEqual([
      { id: '4', name: 'Site 4' },
    ])
  })
})
