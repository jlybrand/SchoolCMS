import { describe, expect, it } from 'vitest'

import {
  MAX_QUERY_LENGTH,
  MATCH_END,
  MATCH_START,
  normalizeQuery,
  parseSearchParams,
  SEARCH_PATH,
  searchHref,
  splitSnippet,
} from '@/lib/search'

/**
 * Site search's pure parts (Jason, 2026-11-16; Phase 6 D): what a visitor typed, made safe to
 * search, and Postgres's highlighted snippet turned into parts a component renders as `<mark>` —
 * never as HTML.
 */

describe('normalizeQuery', () => {
  it('trims and squeezes spaces; nothing is null', () => {
    expect(normalizeQuery('  bus   routes ')).toBe('bus routes')
    expect(normalizeQuery('   ')).toBeNull()
    expect(normalizeQuery(undefined)).toBeNull()
    expect(normalizeQuery(['bus', 'routes'])).toBe('bus')
  })

  it('caps the length', () => {
    expect(normalizeQuery('a'.repeat(1000))?.length).toBe(MAX_QUERY_LENGTH)
  })

  it('strips control characters — including the snippet’s own markers', () => {
    expect(normalizeQuery(`bus${MATCH_START}routes${MATCH_END}`)).toBe('busroutes')
  })
})

describe('splitSnippet', () => {
  it('marked words are matches; the rest is plain text', () => {
    expect(splitSnippet(`Bring a ${MATCH_START}birth${MATCH_END} certificate.`)).toEqual([
      { text: 'Bring a ', match: false },
      { text: 'birth', match: true },
      { text: ' certificate.', match: false },
    ])
  })

  it('markup in the text stays text — the parts are rendered, never parsed', () => {
    expect(splitSnippet('<script>alert(1)</script>')).toEqual([
      { text: '<script>alert(1)</script>', match: false },
    ])
  })

  it('line breaks read as spaces; empty is no parts', () => {
    expect(splitSnippet('One\n\nTwo')).toEqual([{ text: 'One Two', match: false }])
    expect(splitSnippet('')).toEqual([])
  })
})

describe('searchHref — the address of a results page', () => {
  it('/search with the words, in the visitor’s language', () => {
    expect(searchHref({ query: 'bus routes', scope: 'site', page: 1 }, 'en', 'site')).toBe(
      '/search?q=bus+routes',
    )
    expect(searchHref({ query: 'bus', scope: 'site', page: 1 }, 'es', 'site')).toBe(
      '/es/search?q=bus',
    )
    expect(SEARCH_PATH).toBe('/search')
  })

  it('names the scope only when it is not the site’s default, and the page only after the first', () => {
    expect(searchHref({ query: 'bus', scope: 'all', page: 2 }, 'en', 'site')).toBe(
      '/search?q=bus&scope=all&page=2',
    )
    // The district site searches everything by default, so "this site only" is the named one.
    expect(searchHref({ query: 'bus', scope: 'site', page: 1 }, 'en', 'all')).toBe(
      '/search?q=bus&scope=site',
    )
    expect(searchHref({ query: 'bus', scope: 'all', page: 1 }, 'en', 'all')).toBe('/search?q=bus')
  })
})

describe('parseSearchParams — what the address asks for', () => {
  it('the words, the scope (else the site’s default) and the page (else 1)', () => {
    expect(parseSearchParams({ q: ' bus ', scope: 'all', page: '3' }, 'site')).toEqual({
      query: 'bus',
      scope: 'all',
      page: 3,
    })
    expect(parseSearchParams({}, 'site')).toEqual({ query: null, scope: 'site', page: 1 })
    expect(parseSearchParams({}, 'all')).toEqual({ query: null, scope: 'all', page: 1 })
  })

  it('anything else is the default, never an error', () => {
    expect(parseSearchParams({ scope: 'everywhere', page: '-2' }, 'site')).toEqual({
      query: null,
      scope: 'site',
      page: 1,
    })
    expect(parseSearchParams({ page: ['2', '9'], q: ['a', 'b'] }, 'site')).toMatchObject({
      query: 'a',
      page: 2,
    })
    expect(parseSearchParams({ page: '99999999' }, 'site').page).toBe(100)
  })
})
