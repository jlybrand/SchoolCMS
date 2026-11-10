import { describe, expect, it } from 'vitest'

import { diffPage, diffPost } from '@/admin/Approvals/page-diff'

/**
 * The inline diff the district approves from (`04` §4.2): "field-by-field for typed content
 * and as a rendered-HTML comparison for rich text".
 *
 * `live` is the published page (null when it has never been published); `proposed` is the
 * version waiting. The diff is what the reviewer reads before one click publishes, so what it
 * leaves out is as important as what it shows: an unchanged field is not listed, and the body
 * is compared block by block so a one-line edit to a long page reads as one line.
 */

const text = (value: string, format = 0) => ({ type: 'text', text: value, format })
const para = (...children: unknown[]) => ({ type: 'paragraph', children })
const heading = (value: string, tag = 'h2') => ({ type: 'heading', tag, children: [text(value)] })
const list = (...items: string[]) => ({
  type: 'list',
  listType: 'bullet',
  children: items.map((item) => ({ type: 'listitem', children: [text(item)] })),
})
const body = (...children: unknown[]) => ({ root: { type: 'root', children } })

const live = {
  title: 'Bus routes',
  slug: 'bus-routes',
  pageType: 'standard',
  visibility: 'public',
  meta: { title: null, description: null },
  body: body(para(text('Buses leave at 3:15.')), para(text('Route 4 is cancelled.'))),
}

describe('diffPage — typed fields', () => {
  it('lists nothing when nothing changed', () => {
    expect(diffPage(live, live)).toEqual({ isNew: false, fields: [], body: null })
  })

  it('lists a changed title with before and after', () => {
    const diff = diffPage(live, { ...live, title: 'Bus routes and times' })
    expect(diff.fields).toEqual([
      { field: 'title', label: 'Title', before: 'Bus routes', after: 'Bus routes and times' },
    ])
  })

  it('names visibility in words, not stored values', () => {
    const diff = diffPage(live, { ...live, visibility: 'staff' })
    expect(diff.fields).toEqual([
      { field: 'visibility', label: 'Who can see it', before: 'Anyone', after: 'Staff only' },
    ])
  })

  it('says nothing about the page type — every page is composed, there is no choice to review', () => {
    expect(diffPage(live, { ...live, pageType: 'composed' }).fields).toEqual([])
  })

  it('shows the address as the path it will have', () => {
    const diff = diffPage(live, { ...live, slug: 'buses' })
    expect(diff.fields).toEqual([
      { field: 'slug', label: 'Address', before: '/bus-routes', after: '/buses' },
    ])
  })

  it('reads the search fields inside the meta group', () => {
    const diff = diffPage(live, {
      ...live,
      meta: { title: 'Bus routes', description: 'When the buses leave.' },
    })
    expect(diff.fields).toEqual([
      { field: 'meta.title', label: 'Title in search results', before: null, after: 'Bus routes' },
      {
        field: 'meta.description',
        label: 'Description in search results',
        before: null,
        after: 'When the buses leave.',
      },
    ])
  })

  it('treats empty and missing text as the same thing', () => {
    expect(diffPage({ ...live, meta: { title: '' } }, { ...live, meta: {} }).fields).toEqual([])
  })

  it("shows a moved page by the parent's title when it was populated", () => {
    const diff = diffPage(
      { ...live, parent: null },
      { ...live, parent: { id: 9, title: 'Transportation' } },
    )
    expect(diff.fields).toEqual([
      {
        field: 'parent',
        label: 'Placed under',
        before: 'Top of the site',
        after: 'Transportation',
      },
    ])
  })

  it('compares an unpopulated parent by id', () => {
    expect(
      diffPage({ ...live, parent: 9 }, { ...live, parent: { id: 9, title: 'X' } }).fields,
    ).toEqual([])
  })
})

describe('diffPage — the body, block by block', () => {
  it('a reworded paragraph reads as one removed and one added, the rest unchanged', () => {
    const diff = diffPage(live, {
      ...live,
      body: body(para(text('Buses leave at 3:15.')), para(text('Route 4 runs as normal.'))),
    })
    expect(diff.body).toEqual({
      unchanged: 1,
      changes: [
        { change: 'removed', kind: 'paragraph', lines: ['Route 4 is cancelled.'] },
        { change: 'added', kind: 'paragraph', lines: ['Route 4 runs as normal.'] },
      ],
    })
  })

  it('an inserted block is only an addition', () => {
    const diff = diffPage(live, {
      ...live,
      body: body(
        para(text('Buses leave at 3:15.')),
        heading('Early release'),
        para(text('Route 4 is cancelled.')),
      ),
    })
    expect(diff.body).toEqual({
      unchanged: 2,
      changes: [{ change: 'added', kind: 'heading', lines: ['Early release'] }],
    })
  })

  it('a list is shown item by item', () => {
    const diff = diffPage(
      { ...live, body: body() },
      { ...live, body: body(list('Route 1', 'Route 2')) },
    )
    expect(diff.body).toEqual({
      unchanged: 0,
      changes: [{ change: 'added', kind: 'list', lines: ['Route 1', 'Route 2'] }],
    })
  })

  it('a link keeps its destination visible — the reviewer must see where it goes', () => {
    const link = {
      type: 'link',
      fields: { url: 'https://example.org/forms' },
      children: [text('the form')],
    }
    const diff = diffPage(
      { ...live, body: body() },
      { ...live, body: body(para(text('Fill in '), link)) },
    )
    expect(diff.body?.changes).toEqual([
      {
        change: 'added',
        kind: 'paragraph',
        lines: ['Fill in the form (https://example.org/forms)'],
      },
    ])
  })

  it('formatting-only changes are not hidden — bold text counts as different', () => {
    const diff = diffPage(live, {
      ...live,
      body: body(para(text('Buses leave at 3:15.', 1)), para(text('Route 4 is cancelled.'))),
    })
    expect(diff.body?.changes.map((c) => c.change)).toEqual(['removed', 'added'])
  })

  it('an empty body on both sides is no body change', () => {
    expect(diffPage({ ...live, body: null }, { ...live, body: body() }).body).toBeNull()
  })

  it('a malformed body never throws — it reads as empty', () => {
    expect(() =>
      diffPage({ ...live, body: 'nonsense' }, { ...live, body: { root: 7 } }),
    ).not.toThrow()
  })
})

describe('diffPage — a page that has never been published', () => {
  it('is new, and lists what it will have, each field as an addition', () => {
    const diff = diffPage(null, { ...live, meta: {} })
    expect(diff.isNew).toBe(true)
    expect(diff.fields).toEqual([
      { field: 'title', label: 'Title', before: null, after: 'Bus routes' },
      { field: 'slug', label: 'Address', before: null, after: '/bus-routes' },
      { field: 'visibility', label: 'Who can see it', before: null, after: 'Anyone' },
      { field: 'parent', label: 'Placed under', before: null, after: 'Top of the site' },
    ])
    expect(diff.body?.changes.every((c) => c.change === 'added')).toBe(true)
    expect(diff.body?.unchanged).toBe(0)
  })
})

/**
 * An announcement's diff — the same shape, its own fields. The district-only ones (where it is
 * shared, its date) are absent for the reason pages leave out `layout`: a school cannot write
 * them, so they are never what a school is asking to publish.
 */
describe('diffPost', () => {
  const post = {
    title: 'Picture day',
    slug: 'picture-day',
    excerpt: 'Smile.',
    visibility: 'public',
    syndication: { scope: 'this-tenant' },
    publishedDate: '2026-10-01T00:00:00.000Z',
    body: body(para(text('Thursday.'))),
  }

  it('lists nothing when nothing changed', () => {
    expect(diffPost(post, post)).toEqual({ isNew: false, fields: [], body: null })
  })

  it('lists a changed headline and summary in words', () => {
    const diff = diffPost(post, { ...post, title: 'Picture day moved', excerpt: '' })
    expect(diff.fields).toEqual([
      { field: 'title', label: 'Headline', before: 'Picture day', after: 'Picture day moved' },
      { field: 'excerpt', label: 'Summary', before: 'Smile.', after: null },
    ])
  })

  it('a new announcement lists headline, address and who can see it, then its words', () => {
    const diff = diffPost(null, post)
    expect(diff.isNew).toBe(true)
    expect(diff.fields.map((f) => [f.label, f.after])).toEqual([
      ['Headline', 'Picture day'],
      ['Address', '/news/picture-day'],
      ['Board', null],
      ['Summary', 'Smile.'],
      ['Who can see it', 'Anyone'],
    ])
    expect(diff.body?.changes).toEqual([
      { change: 'added', kind: 'paragraph', lines: ['Thursday.'] },
    ])
  })

  it('names the board and the tags, not their ids', () => {
    const before = {
      ...post,
      board: { id: 7, title: 'SHS → News' },
      tags: [{ id: 1, title: 'High' }],
    }
    const after = {
      ...post,
      board: { id: 8, title: 'SHS → Athletics' },
      tags: [
        { id: 2, title: 'Sports' },
        { id: 1, title: 'High' },
      ],
    }
    expect(diffPost(before, after).fields).toEqual([
      { field: 'board', label: 'Board', before: 'SHS → News', after: 'SHS → Athletics' },
      { field: 'tags', label: 'Tags', before: 'High', after: 'High, Sports' },
    ])
  })

  it('the order tags were ticked in is not a change', () => {
    const one = {
      ...post,
      tags: [
        { id: 1, title: 'High' },
        { id: 2, title: 'Sports' },
      ],
    }
    const two = {
      ...post,
      tags: [
        { id: 2, title: 'Sports' },
        { id: 1, title: 'High' },
      ],
    }
    expect(diffPost(one, two).fields).toEqual([])
  })

  it('ignores the district-only fields', () => {
    const shared = { ...post, syndication: { scope: 'district-wide' }, publishedDate: null }
    expect(diffPost(post, shared).fields).toEqual([])
  })
})
