import { describe, expect, it } from 'vitest'

import { toSearchEntry } from '@/content/search-entry'

/**
 * What the search index holds for a document (Jason, 2026-11-16; Phase 6 D). PURE — the plugin's
 * `beforeSync` calls it with the document being saved.
 *
 * Every authored word goes in; nothing a visitor cannot see does. An entry that must not be found
 * is still written, marked `excluded`: the plugin never removes an entry it skips, so a live post
 * switched to staff-only would otherwise stay findable.
 */

const lexical = (...paragraphs: string[]) => ({
  root: {
    type: 'root',
    children: paragraphs.map((text) => ({
      type: 'paragraph',
      children: [{ type: 'text', text, format: 0 }],
    })),
  },
})

describe('pages — every authored word in the sections', () => {
  const page = (layout: unknown[], extra: Record<string, unknown> = {}) => ({
    id: 4,
    tenant: { id: 3 },
    title: 'Enrollment',
    visibility: 'public',
    layout,
    ...extra,
  })

  it('Text, Button, Cards, Accordion, Image, Hero, and the headings of data sections', () => {
    const entry = toSearchEntry(
      'pages',
      page([
        { blockType: 'richText', content: lexical('Bring a birth certificate.') },
        {
          blockType: 'callToAction',
          heading: 'Ready?',
          text: 'It takes ten minutes.',
          linkLabel: 'Start enrollment',
        },
        {
          blockType: 'cardGrid',
          heading: 'Grades',
          cards: [{ title: 'Kindergarten', text: 'Age five by September.' }],
        },
        {
          blockType: 'accordion',
          heading: 'Questions',
          items: [{ heading: 'Is there a fee?', content: lexical('No.') }],
        },
        { blockType: 'image', image: 12, caption: 'The front office' },
        {
          blockType: 'hero',
          image: 12,
          heading: 'Welcome',
          subheading: 'Home of the Hawks',
          linkLabel: 'Visit',
        },
        { blockType: 'feed', heading: 'Enrollment news', boards: [1] },
        { blockType: 'embed', url: 'https://youtu.be/x', title: 'How to enroll' },
      ]),
    )
    for (const words of [
      'Bring a birth certificate.',
      'Ready?',
      'It takes ten minutes.',
      'Start enrollment',
      'Grades',
      'Kindergarten',
      'Age five by September.',
      'Questions',
      'Is there a fee?',
      'No.',
      'The front office',
      'Welcome',
      'Home of the Hawks',
      'Visit',
      'Enrollment news',
      'How to enroll',
    ]) {
      expect(entry.text).toContain(words)
    }
    expect(entry).toMatchObject({ kind: 'page', tenant: '3', title: 'Enrollment', excluded: false })
  })

  it('reads inside Columns, and lists and headings inside Text', () => {
    const list = {
      root: {
        type: 'root',
        children: [
          { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Supplies' }] },
          {
            type: 'list',
            listType: 'bullet',
            children: [{ type: 'listitem', children: [{ type: 'text', text: 'Two pencils' }] }],
          },
        ],
      },
    }
    const entry = toSearchEntry(
      'pages',
      page([
        {
          blockType: 'columns',
          heading: 'Getting ready',
          columns: [{ heading: 'First day', content: [{ blockType: 'richText', content: list }] }],
        },
      ]),
    )
    for (const words of ['Getting ready', 'First day', 'Supplies', 'Two pencils']) {
      expect(entry.text).toContain(words)
    }
  })

  it('staff-only or "Hide from site search": written, but excluded', () => {
    expect(toSearchEntry('pages', page([], { visibility: 'staff' })).excluded).toBe(true)
    expect(toSearchEntry('pages', page([], { hideFromSiteSearch: true })).excluded).toBe(true)
  })
})

describe('announcements', () => {
  const post = (extra: Record<string, unknown> = {}) => ({
    id: 9,
    tenant: 3,
    title: 'Picture day',
    excerpt: 'Smile.',
    body: lexical('Thursday, in the gym.'),
    visibility: 'public',
    ...extra,
  })

  it('headline, summary and body; its own site only by default', () => {
    expect(toSearchEntry('posts', post())).toMatchObject({
      kind: 'post',
      tenant: '3',
      title: 'Picture day',
      excluded: false,
      reachAll: false,
      reachSites: [],
    })
    expect(toSearchEntry('posts', post()).text).toContain('Smile.')
    expect(toSearchEntry('posts', post()).text).toContain('Thursday, in the gym.')
  })

  it('shared district-wide, or with chosen sites: the reach the query reads', () => {
    expect(toSearchEntry('posts', post({ syndication: { scope: 'district-wide' } }))).toMatchObject(
      { reachAll: true, reachSites: [] },
    )
    expect(
      toSearchEntry(
        'posts',
        post({ syndication: { scope: 'selected', syndicatedTo: [5, { id: 6 }] } }),
      ),
    ).toMatchObject({ reachAll: false, reachSites: ['5', '6'] })
    // Chosen sites, but "this site" selected: the list is ignored, as feeds ignore it.
    expect(
      toSearchEntry('posts', post({ syndication: { scope: 'this-tenant', syndicatedTo: [5] } })),
    ).toMatchObject({ reachAll: false, reachSites: [] })
  })

  it('staff-only: excluded', () => {
    expect(toSearchEntry('posts', post({ visibility: 'staff' })).excluded).toBe(true)
  })
})

describe('events', () => {
  const event = (extra: Record<string, unknown> = {}) => ({
    id: 2,
    tenant: 3,
    calendar: 7,
    title: 'Open house',
    location: 'Gym',
    notes: lexical('Meet the teachers.'),
    start: '2026-12-04T23:30:00.000Z',
    ...extra,
  })

  it('title, location and notes; its last day is its start', () => {
    const entry = toSearchEntry('events', event())
    expect(entry).toMatchObject({
      kind: 'event',
      title: 'Open house',
      lastDate: '2026-12-04T23:30:00.000Z',
      excluded: false,
    })
    expect(entry.text).toContain('Gym')
    expect(entry.text).toContain('Meet the teachers.')
  })

  it('its last day is when it ends, or when it stops repeating', () => {
    expect(toSearchEntry('events', event({ end: '2026-12-05T01:00:00.000Z' })).lastDate).toBe(
      '2026-12-05T01:00:00.000Z',
    )
    expect(
      toSearchEntry(
        'events',
        event({ end: '2026-12-05T01:00:00.000Z', repeatUntil: '2027-06-01T00:00:00.000Z' }),
      ).lastDate,
    ).toBe('2027-06-01T00:00:00.000Z')
  })
})

describe('library files — documents only, by title and description', () => {
  const file = (extra: Record<string, unknown> = {}) => ({
    id: 11,
    tenant: 3,
    kind: 'document',
    title: 'Bus request',
    description: 'Return it to the office.',
    url: '/api/resources/file/bus.pdf',
    ...extra,
  })

  it('a document: its title, description and the file’s address', () => {
    expect(toSearchEntry('resources', file())).toMatchObject({
      kind: 'document',
      title: 'Bus request',
      text: 'Return it to the office.',
      href: '/api/resources/file/bus.pdf',
      excluded: false,
    })
  })

  it('an image is excluded', () => {
    expect(toSearchEntry('resources', file({ kind: 'image' })).excluded).toBe(true)
  })
})

describe('anything the index cannot use is excluded', () => {
  it('no site or no title', () => {
    expect(toSearchEntry('pages', { id: 1, title: 'X', layout: [] }).excluded).toBe(true)
    expect(toSearchEntry('posts', { id: 1, tenant: 3, title: '  ' }).excluded).toBe(true)
  })

  it('keeps the text to a sensible length', () => {
    const long = 'word '.repeat(20_000)
    const entry = toSearchEntry('posts', { id: 1, tenant: 3, title: 'Long', excerpt: long })
    expect(entry.text.length).toBeLessThanOrEqual(50_000)
  })
})
