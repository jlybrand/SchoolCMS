import { describe, expect, it } from 'vitest'

import { formatPostDate, postHref, postPath, toNewsItems } from '@/lib/post-url'

/**
 * Where an announcement lives (Jason, 2026-10-28): `/news/{slug}` on its HOME site. Shown on
 * another site's list because it is shared there, it links home — one address per announcement,
 * one cached page, one search result.
 */

describe('postPath', () => {
  it('is /news/{slug}', () => {
    expect(postPath('picture-day')).toBe('/news/picture-day')
  })
})

describe('postHref', () => {
  const post = { slug: 'picture-day', tenantId: '3', homeHostname: 'dd2.org' }

  it('on its own site: a site path, in the visitor’s language', () => {
    expect(postHref(post, { siteTenantId: '3', locale: 'en', serverUrl: '' })).toBe(
      '/news/picture-day',
    )
    expect(postHref(post, { siteTenantId: '3', locale: 'es', serverUrl: '' })).toBe(
      '/es/news/picture-day',
    )
  })

  it('shared to another site: its home site’s address, keeping the server’s scheme and port', () => {
    expect(
      postHref(
        { ...post, homeHostname: 'localhost' },
        { siteTenantId: '9', locale: 'en', serverUrl: 'http://localhost:3000' },
      ),
    ).toBe('http://localhost:3000/news/picture-day')
    expect(
      postHref(post, { siteTenantId: '9', locale: 'es', serverUrl: 'https://admin.dd2.org' }),
    ).toBe('https://dd2.org/news/picture-day')
  })

  it('shared, with no known home: no link rather than a guessed one', () => {
    expect(
      postHref({ ...post, homeHostname: null }, { siteTenantId: '9', locale: 'en', serverUrl: '' }),
    ).toBeNull()
  })
})

describe('formatPostDate', () => {
  it('reads as a date in the district’s time zone', () => {
    // 02:30 UTC on the 29th is still the 28th in South Carolina.
    expect(formatPostDate('2026-10-29T02:30:00.000Z', 'en')).toBe('October 28, 2026')
  })

  it('in the visitor’s language', () => {
    expect(formatPostDate('2026-10-28T15:00:00.000Z', 'es')).toBe('28 de octubre de 2026')
  })

  it('nothing for no date or a date that is not one', () => {
    expect(formatPostDate(null, 'en')).toBeNull()
    expect(formatPostDate('soon', 'en')).toBeNull()
  })
})

describe('toNewsItems — a list of announcements, ready to render', () => {
  const para = (text: string) => ({
    kind: 'paragraph' as const,
    children: [{ kind: 'text' as const, text, marks: [] }],
  })
  const post = {
    id: '1',
    tenantId: '3',
    title: 'Picture day',
    slug: 'picture-day',
    excerpt: null,
    body: [para('Thursday, in the gym.')],
    publishedDate: '2026-10-28T15:00:00.000Z',
    boardId: '5',
    tagIds: [],
    homeHostname: 'a.localhost',
  }
  const where = { siteTenantId: '3', locale: 'en', serverUrl: 'http://localhost:3000' }

  it('a headline, its link, its date in words and as a machine date, and a summary', () => {
    expect(toNewsItems([post], where)).toEqual([
      {
        id: '1',
        title: 'Picture day',
        href: '/news/picture-day',
        date: { iso: '2026-10-28T15:00:00.000Z', label: 'October 28, 2026' },
        summary: 'Thursday, in the gym.',
      },
    ])
  })

  it('the editor’s summary wins over the first paragraph', () => {
    expect(toNewsItems([{ ...post, excerpt: 'Smile!' }], where)[0]!.summary).toBe('Smile!')
  })

  it('no date is no date line, not "Invalid Date"', () => {
    expect(toNewsItems([{ ...post, publishedDate: null }], where)[0]!.date).toBeNull()
  })
})
