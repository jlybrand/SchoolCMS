// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { Link } from '@/components/Link'

import { renderComponent } from '../../helpers/render'

/**
 * Links (`07` §3).
 *
 * Two things are structural rather than left to the author:
 *
 *   - **A new window is announced.** WCAG 3.2.5 is AAA, but an unannounced new tab is a
 *     genuine orientation problem for screen-reader and magnifier users, and the notice
 *     costs nothing when the component owns it.
 *   - **`rel` follows `target`.** `target="_blank"` without `rel="noopener"` hands the
 *     opened page a handle on this one. Coupling them in one component means no block
 *     author has to remember.
 *
 * Plain anchors, deliberately — no client-side router. This is a cache-first static site, so
 * client navigation would buy nothing and cost the route-change announcement problem
 * (a soft navigation moves no focus and speaks no page title unless the app reimplements
 * it).
 */

describe('Link', () => {
  it('renders an internal link as a plain anchor', () => {
    const { getByRole } = renderComponent(<Link href="/about">About the district</Link>)

    const link = getByRole('link', { name: 'About the district' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/about')
    expect(link.getAttribute('target')).toBeNull()
    expect(link.getAttribute('rel')).toBeNull()
  })

  it('marks an external destination without changing its behaviour', () => {
    const { getByRole } = renderComponent(
      <Link href="https://www.berkeleycountysc.gov">County site</Link>,
    )

    const link = getByRole('link', { name: 'County site' })
    expect(link.dataset.external).toBe('true')
    expect(link.getAttribute('target')).toBeNull()
  })

  it('treats mailto and tel as neither internal nor a new window', () => {
    const { getByRole } = renderComponent(<Link href="mailto:info@dd2.example">Email us</Link>)

    const link = getByRole('link', { name: 'Email us' })
    expect(link.getAttribute('target')).toBeNull()
    expect(link.getAttribute('rel')).toBeNull()
  })

  it('announces a new window in the accessible name', () => {
    const { getByRole } = renderComponent(
      <Link href="https://forms.office.com/x" newWindow>
        Registration form
      </Link>,
    )

    const link = getByRole('link', { name: /Registration form.*opens in a new window/i })
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('pairs rel with target so an opened page gets no handle on this one', () => {
    const { getByRole } = renderComponent(
      <Link href="https://forms.office.com/x" newWindow>
        Registration form
      </Link>,
    )

    const rel = getByRole('link', { name: /Registration form/i }).getAttribute('rel') ?? ''
    expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
  })

  it('carries lang and hreflang for a link whose text is in another language', () => {
    // WCAG 3.1.2 Language of Parts. The language switcher names each language in its own
    // script (`08` §6), so without `lang` a screen reader reads 简体中文 with an English
    // voice — which is unintelligible rather than merely wrong.
    const { getByRole } = renderComponent(
      <Link href="/ko/" lang="ko" hrefLang="ko">
        한국어
      </Link>,
    )

    const link = getByRole('link', { name: '한국어' })
    expect(link.getAttribute('lang')).toBe('ko')
    expect(link.getAttribute('hreflang')).toBe('ko')
  })

  it('does not repeat the new-window notice visibly', () => {
    // The notice is for the accessible name only; a visible "(opens in a new window)" on
    // every external link is clutter that editors will ask to remove.
    const { getByRole } = renderComponent(
      <Link href="https://forms.office.com/x" newWindow>
        Registration form
      </Link>,
    )

    const notice = getByRole('link', { name: /opens in a new window/i }).querySelector(
      '[data-visually-hidden]',
    )
    expect(notice?.textContent).toMatch(/opens in a new window/i)
  })
})
