import { describe, expect, it } from 'vitest'

import { PERMALINK_SEGMENT, parsePermalinkId, permalinkPath } from '@/lib/permalink'
import { isReservedTopLevelSlug } from '@/lib/slug'

/**
 * Permalinks (Jason, 2026-10-29): every page has an address that does not change when the page
 * is renamed or moved — Finalsite's `/fs/pages/<id>`. Ours is `/p/<id>`, and it redirects to
 * wherever the page is now.
 */
describe('permalinkPath', () => {
  it('is /p/ and the page id', () => {
    expect(permalinkPath('12')).toBe('/p/12')
    expect(permalinkPath(12)).toBe('/p/12')
  })
})

describe('parsePermalinkId', () => {
  it('accepts a page id', () => {
    expect(parsePermalinkId('12')).toBe('12')
    expect(parsePermalinkId('987654')).toBe('987654')
  })

  /**
   * Anything else is refused before it reaches a query, so `/p/` is never a way to probe the
   * database with arbitrary input.
   */
  it('refuses anything that is not a page id', () => {
    for (const raw of ['', '0', '-1', '1.5', '1e3', 'abc', '12abc', ' 12', '012', '1'.repeat(19)]) {
      expect(parsePermalinkId(raw), raw).toBeNull()
    }
    expect(parsePermalinkId(undefined)).toBeNull()
    expect(parsePermalinkId(null)).toBeNull()
  })
})

describe('the permalink segment', () => {
  it('is reserved, so no top-level page can take /p', () => {
    expect(PERMALINK_SEGMENT).toBe('p')
    expect(isReservedTopLevelSlug('p')).toBe(true)
    expect(isReservedTopLevelSlug('P')).toBe(true)
  })

  it('reserves only the top level — a page called "p" under another page is fine', () => {
    expect(isReservedTopLevelSlug('pe')).toBe(false)
  })
})
