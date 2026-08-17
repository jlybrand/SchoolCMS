// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { MAIN_CONTENT_ID, SkipLink } from '@/components/SkipLink'

import { renderComponent } from '../../helpers/render'

/**
 * Bypass blocks — WCAG 2.4.1 (`07` §3).
 *
 * Every tenant page carries the same navigation before its content, so a keyboard or
 * screen-reader user needs one move to get past it. The target id is exported rather than
 * written as a string in two places: a skip link pointing at an element that no longer
 * exists still looks correct in review and silently does nothing.
 */

describe('SkipLink', () => {
  it('targets the shared main-content id', () => {
    const { getByRole } = renderComponent(<SkipLink>Skip to main content</SkipLink>)

    expect(getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe(
      `#${MAIN_CONTENT_ID}`,
    )
  })

  it('accepts an explicit target for pages with a different first landmark', () => {
    const { getByRole } = renderComponent(<SkipLink targetId="search-results">Skip</SkipLink>)
    expect(getByRole('link', { name: 'Skip' }).getAttribute('href')).toBe('#search-results')
  })

  it('keeps its label in the accessible tree while hidden', () => {
    // Hiding is visual only (a focus-revealed off-screen link). `display: none` or
    // `aria-hidden` would take it out of the tab order, which is the whole point of it.
    const { getByRole } = renderComponent(<SkipLink>Skip to main content</SkipLink>)

    const link = getByRole('link', { name: 'Skip to main content' })
    expect(link.getAttribute('aria-hidden')).toBeNull()
    expect(link.hasAttribute('hidden')).toBe(false)
    expect(link.getAttribute('tabindex')).toBeNull()
  })
})
