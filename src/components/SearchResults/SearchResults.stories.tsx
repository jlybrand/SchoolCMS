import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { SearchResult } from '@/content/types'

import { SearchResults } from './SearchResults'

/**
 * Site search results (Jason, 2026-11-16; Phase 6 D), as `searchSite` hands them over: a page, a
 * shared announcement from the district, an event, and a document.
 */
const meta = {
  title: 'Components/SearchResults',
  component: SearchResults,
} satisfies Meta<typeof SearchResults>

export default meta

type Story = StoryObj<typeof meta>

const words = (before: string, match: string, after: string) => [
  { text: before, match: false },
  { text: match, match: true },
  { text: after, match: false },
]

const RESULTS: SearchResult[] = [
  {
    id: 'page-1',
    kind: 'page',
    title: 'Enrollment',
    href: '/enrollment',
    siteName: null,
    snippet: words('Bring a ', 'birth', ' certificate and proof of address to the front office.'),
    event: null,
    file: null,
  },
  {
    id: 'post-2',
    kind: 'post',
    title: 'Snow day: schools closed Friday',
    href: 'https://dd2.org/news/snow-day',
    siteName: 'DD2 District',
    snippet: words(
      'All schools and offices are ',
      'closed',
      '. Meals are available at the high school.',
    ),
    event: null,
    file: null,
  },
  {
    id: 'event-3',
    kind: 'event',
    title: 'Open house',
    href: null,
    siteName: null,
    snippet: words('Meet the teachers and see the ', 'classrooms', '.'),
    event: { when: 'Friday, December 4, 2026, 6:00 – 8:00 PM', location: 'Gym' },
    file: null,
  },
  {
    id: 'document-4',
    kind: 'document',
    title: 'Bus request form',
    href: '/api/resources/file/bus-request.pdf',
    siteName: null,
    snippet: words('Return it to the ', 'office', ' by Friday.'),
    event: null,
    file: 'PDF, 240 KB',
  },
]

export const Default: Story = { args: { results: RESULTS, start: 1, level: 2 } }

/** Page two: numbering continues from 11. */
export const SecondPage: Story = { args: { results: RESULTS.slice(0, 2), start: 11, level: 2 } }
