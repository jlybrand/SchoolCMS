import { describe, expect, it } from 'vitest'

import {
  MAX_QUERY_LENGTH,
  MATCH_END,
  MATCH_START,
  normalizeQuery,
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
