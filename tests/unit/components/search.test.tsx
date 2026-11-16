// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { SearchForm } from '@/components/SearchForm'
import { SearchResults } from '@/components/SearchResults'
import type { SearchResult } from '@/content/types'

import { renderComponent } from '../../helpers/render'

/**
 * The search box and the results list (Jason, 2026-11-16; Phase 6 D). Semantics only — the
 * landmark, the label, the numbering, the headings, the marked words. Contrast and RTL are the
 * Storybook gate's.
 */

describe('SearchForm', () => {
  it('a visible label on the results page; the words and the scope kept', () => {
    const { getByRole, container } = renderComponent(
      <SearchForm
        action="/search"
        id="page-search"
        landmark="Search again"
        query="bus routes"
        scope="all"
        showLabel
      />,
    )
    const field = getByRole('searchbox', { name: 'Search this site' }) as HTMLInputElement
    expect(field.value).toBe('bus routes')
    expect(
      container.querySelector('input[type="hidden"][name="scope"]')?.getAttribute('value'),
    ).toBe('all')
    expect(getByRole('search', { name: 'Search again' })).toBeTruthy()
  })

  it('no scope, no hidden field', () => {
    const { container } = renderComponent(
      <SearchForm action="/search" id="s" landmark="Site search" />,
    )
    expect(container.querySelector('input[type="hidden"]')).toBeNull()
  })
})

const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  id: 'page-1',
  kind: 'page',
  title: 'Enrollment',
  href: '/enrollment',
  siteName: null,
  snippet: [
    { text: 'Bring a ', match: false },
    { text: 'birth', match: true },
    { text: ' certificate.', match: false },
  ],
  event: null,
  file: null,
  ...over,
})

describe('SearchResults', () => {
  it('an ordered list numbered from this page’s first result; each title a linked heading', () => {
    const { container, getByRole } = renderComponent(
      <SearchResults level={2} results={[result()]} start={11} />,
    )
    expect(container.querySelector('ol')?.getAttribute('start')).toBe('11')
    const heading = getByRole('heading', { level: 2, name: 'Enrollment' })
    expect(heading.querySelector('a')?.getAttribute('href')).toBe('/enrollment')
  })

  it('the matched words in <mark>, as text — never markup', () => {
    const { container } = renderComponent(
      <SearchResults
        level={2}
        start={1}
        results={[result({ snippet: [{ text: '<b>bold</b>', match: true }] })]}
      />,
    )
    const mark = container.querySelector('mark')!
    expect(mark.textContent).toBe('<b>bold</b>')
    expect(container.querySelector('b')).toBeNull()
  })

  it('says what kind each is, its file, and another site’s name — in words', () => {
    const { container } = renderComponent(
      <SearchResults
        level={2}
        start={1}
        results={[
          result({ id: 'd', kind: 'document', title: 'Bus request', file: 'PDF, 240 KB' }),
          result({ id: 'p', kind: 'post', title: 'Snow day', siteName: 'DD2 District' }),
        ]}
      />,
    )
    const items = [...container.querySelectorAll('li')].map(
      (li) => li.querySelector('p')?.textContent,
    )
    expect(items).toEqual(['Document · PDF, 240 KB', 'Announcement · DD2 District'])
  })

  it('an event: its time and place; with no calendar page, a title but no link', () => {
    const { container, getByRole } = renderComponent(
      <SearchResults
        level={2}
        start={1}
        results={[
          result({
            id: 'e',
            kind: 'event',
            title: 'Open house',
            href: null,
            event: { when: 'Friday, December 4, 2026, 6:00 – 8:00 PM', location: 'Gym' },
          }),
        ]}
      />,
    )
    expect(getByRole('heading', { name: 'Open house' }).querySelector('a')).toBeNull()
    expect(container.textContent).toContain('Friday, December 4, 2026, 6:00 – 8:00 PM · Gym')
  })
})
