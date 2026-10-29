import { describe, expect, it } from 'vitest'

import { PERMALINK_SEGMENT, parsePermalinkId, permalinkPath } from '@/lib/permalink'
import { isReservedTopLevelSlug } from '@/lib/slug'

/**
 * Permalinks (Jason, 2026-10-29): every page has an address that does not change when the page
 * is renamed or moved — Finalsite's `/fs/pages/<id>`. Ours is `/dd2/pages/<id>`, and it redirects to
 * wherever the page is now.
 */
describe('permalinkPath', () => {
  it('is /dd2/pages/ and the page id', () => {
    expect(permalinkPath('12')).toBe('/dd2/pages/12')
    expect(permalinkPath(12)).toBe('/dd2/pages/12')
  })
})

describe('parsePermalinkId', () => {
  it('accepts a page id', () => {
    expect(parsePermalinkId('12')).toBe('12')
    expect(parsePermalinkId('987654')).toBe('987654')
  })

  /**
   * Anything else is refused before it reaches a query, so `/dd2/pages/` is never a way to probe the
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
  it('is reserved, so no top-level page can take /dd2', () => {
    expect(PERMALINK_SEGMENT).toBe('dd2')
    expect(isReservedTopLevelSlug('dd2')).toBe(true)
    expect(isReservedTopLevelSlug('DD2')).toBe(true)
  })

  it('reserves only that segment — /pages and /p stay ordinary addresses', () => {
    expect(isReservedTopLevelSlug('pages')).toBe(false)
    expect(isReservedTopLevelSlug('p')).toBe(false)
    expect(isReservedTopLevelSlug('dd2-news')).toBe(false)
  })
})
