import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { NewsItem } from '@/lib/post-url'

import { NewsList } from './NewsList'

/**
 * Announcements in a list (Jason, 2026-10-28). The items arrive ready — link, date, summary —
 * as `toNewsItems` makes them; the component fetches and decides nothing (CLAUDE.md rule 1).
 */
const meta = {
  title: 'Components/NewsList',
  component: NewsList,
} satisfies Meta<typeof NewsList>

export default meta

type Story = StoryObj<typeof meta>

const ITEMS: NewsItem[] = [
  {
    id: '1',
    title: 'Picture day is Thursday',
    href: '/news/picture-day-is-thursday',
    date: { iso: '2026-10-28T15:00:00.000Z', label: 'October 28, 2026' },
    summary: 'Photos are taken in the gym during homeroom. Order forms go home Monday.',
  },
  {
    id: '2',
    title: 'Early dismissal on Friday',
    // Shared from the district site, so it links there.
    href: 'https://dd2.org/news/early-dismissal-on-friday',
    date: { iso: '2026-10-27T15:00:00.000Z', label: 'October 27, 2026' },
    summary: null,
  },
  {
    id: '3',
    title: 'Book fair volunteers needed',
    href: null,
    date: null,
    summary: 'Sign up at the front office.',
  },
]

export const Default: Story = {
  args: { items: ITEMS, level: 2, empty: 'There are no announcements yet.' },
}

/** Nothing to list says so in words rather than rendering an empty region. */
export const Empty: Story = {
  args: { items: [], level: 2, empty: 'There are no announcements yet.' },
}
