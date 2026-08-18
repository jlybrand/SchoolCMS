import { describe, expect, it } from 'vitest'

import { buildPagePath, isReservedSlug, slugify, splitPagePath } from '@/lib/slug'

/**
 * Slug generation and page-path assembly (`03` §2).
 *
 * Test-first per CLAUDE.md — slug generation is named explicitly in the mandatory-TDD list.
 * These are pure functions of their inputs, and they sit under a URL: a slug that changes
 * shape between two releases breaks every inbound link and every redirect mapped in `10`.
 * Stability is the property under test, not merely correctness.
 */

describe('slugify', () => {
  it('lowercases and hyphenates a plain title', () => {
    expect(slugify('Bell Schedule')).toBe('bell-schedule')
  })

  it('strips punctuation rather than encoding it', () => {
    expect(slugify("Principal's Message!")).toBe('principals-message')
  })

  it('collapses runs of separators into one hyphen', () => {
    expect(slugify('Sports   &   Activities')).toBe('sports-activities')
  })

  it('trims leading and trailing separators', () => {
    expect(slugify('  --Welcome--  ')).toBe('welcome')
  })

  it('folds diacritics to their ASCII base', () => {
    // A staff page for "José Núñez" must not become a percent-encoded URL.
    expect(slugify('José Núñez')).toBe('jose-nunez')
  })

  it('keeps digits', () => {
    expect(slugify('2026-2027 Calendar')).toBe('2026-2027-calendar')
  })

  it('is idempotent — slugifying a slug returns it unchanged', () => {
    // The authoring UI re-derives the slug on edit. If this were not idempotent, a title
    // that never changed could still produce a new URL on a later save.
    const once = slugify('Family & Community Engagement')
    expect(slugify(once)).toBe(once)
  })

  it('returns an empty string when nothing survives normalization', () => {
    // Caller decides what to do — this function never invents a slug, because a generated
    // fallback like "page-1" is a URL nobody can predict or redirect.
    expect(slugify('！！！')).toBe('')
    expect(slugify('   ')).toBe('')
    expect(slugify('')).toBe('')
  })

  it('handles null and undefined without throwing', () => {
    expect(slugify(null)).toBe('')
    expect(slugify(undefined)).toBe('')
  })

  it('truncates long titles without leaving a trailing hyphen', () => {
    const slug = slugify('a'.repeat(60) + ' ' + 'b'.repeat(60))
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('isReservedSlug', () => {
  /**
   * `/sites/*` is the rewrite target the edge proxy refuses directly (src/proxy.ts), and
   * `/admin` and `/api` are Payload's own mount. A page slugged into any of them would be
   * unreachable at best; at worst it shadows a real route.
   */
  it.each(['sites', 'admin', 'api', '_next'])('reserves %s', (slug) => {
    expect(isReservedSlug(slug)).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isReservedSlug('Admin')).toBe(true)
  })

  it('allows ordinary page slugs', () => {
    expect(isReservedSlug('about')).toBe(false)
    expect(isReservedSlug('bell-schedule')).toBe(false)
  })
})

describe('buildPagePath', () => {
  it('renders the home page as a bare slash', () => {
    expect(buildPagePath([])).toBe('/')
  })

  it('renders a single segment', () => {
    expect(buildPagePath(['about'])).toBe('/about')
  })

  it('joins an ancestor chain in order, parent first', () => {
    expect(buildPagePath(['about', 'staff', 'directory'])).toBe('/about/staff/directory')
  })

  it('never emits a trailing slash', () => {
    expect(buildPagePath(['about']).endsWith('/')).toBe(false)
  })

  it('drops empty and whitespace-only segments rather than emitting //', () => {
    // A double slash is a different URL to the CDN, so it would be a second cache entry
    // for the same page (`02` §5).
    expect(buildPagePath(['about', '', '  ', 'staff'])).toBe('/about/staff')
  })
})

describe('splitPagePath', () => {
  it('round-trips with buildPagePath', () => {
    expect(splitPagePath(buildPagePath(['about', 'staff']))).toEqual(['about', 'staff'])
  })

  it('treats the root path as no segments', () => {
    expect(splitPagePath('/')).toEqual([])
    expect(splitPagePath('')).toEqual([])
  })

  it('ignores leading and trailing slashes', () => {
    expect(splitPagePath('/about/staff/')).toEqual(['about', 'staff'])
  })

  it('collapses repeated slashes', () => {
    expect(splitPagePath('//about//staff')).toEqual(['about', 'staff'])
  })
})
