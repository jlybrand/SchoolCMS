import { describe, expect, it } from 'vitest'

import { linkLabelVerdict } from '@/lib/link-label'

/**
 * A link's own screen-reader words (Jason, 2026-11-19: aria-labels "probably should not be
 * stripped unless they are unnecessary").
 *
 * KEPT only when it ADDS to the visible words and CONTAINS them — WCAG 2.5.3 Label in Name: a
 * voice-control user says what they see, so "Read more" must still be in "Read more about the
 * bond election". One that only repeats the words is unnecessary; one that leaves them out fails
 * 2.5.3. Both are dropped, and the caller names why.
 */
describe('linkLabelVerdict', () => {
  it('keeps a label that adds to the link’s words and contains them', () => {
    expect(linkLabelVerdict('Read more about the bond election', 'Read more')).toEqual({
      keep: 'Read more about the bond election',
    })
  })

  it('trims and collapses the kept label’s spaces', () => {
    expect(linkLabelVerdict('  Read more   about the bond  ', 'Read more')).toEqual({
      keep: 'Read more about the bond',
    })
  })

  it('matches the words ignoring case, spacing and punctuation', () => {
    expect(linkLabelVerdict('Menu (PDF), March 2027', 'menu — PDF')).toEqual({
      keep: 'Menu (PDF), March 2027',
    })
  })

  it('calls a label that only repeats the words unnecessary', () => {
    expect(linkLabelVerdict('Read more.', 'read more')).toEqual({ drop: 'repeats' })
  })

  it('refuses a label that leaves the visible words out (2.5.3)', () => {
    expect(linkLabelVerdict('Bond election details', 'Read more')).toEqual({
      drop: 'missing-words',
    })
  })

  it('treats a blank label as no label', () => {
    expect(linkLabelVerdict('   ', 'Read more')).toEqual({ drop: 'empty' })
    expect(linkLabelVerdict(undefined, 'Read more')).toEqual({ drop: 'empty' })
  })

  it('refuses a label on a link with no words of its own — there is nothing for it to contain', () => {
    expect(linkLabelVerdict('Home', '  ')).toEqual({ drop: 'missing-words' })
  })
})
