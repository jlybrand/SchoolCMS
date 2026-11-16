import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { ResolvedFeedBlock } from '@/content/types'

import { NewsFeed } from './NewsFeed'

/**
 * A news feed, as the resolve pass hands it over (Jason, 2026-10-28) — ready items, no query.
 * No empty story: an empty feed renders nothing, and the component axe gate waits for the root
 * to have a child (see `ChildPageNav.stories.tsx`).
 */
const meta = {
  title: 'Blocks/NewsFeed',
  component: NewsFeed,
} satisfies Meta<typeof NewsFeed>

export default meta

type Story = StoryObj<typeof meta>

const block = (overrides: Partial<ResolvedFeedBlock> = {}): ResolvedFeedBlock => ({
  kind: 'feed',
  id: 'feed',
  heading: 'District news',
  items: [
    {
      id: '1',
      title: 'Snow day: schools closed Friday',
      href: 'https://dd2.org/news/snow-day',
      date: { iso: '2026-10-28T15:00:00.000Z', label: 'October 28, 2026' },
      summary: 'All schools and offices are closed. Meals are available at the high school.',
      thumbnail: null,
    },
    {
      id: '2',
      title: 'Picture day is Thursday',
      href: '/news/picture-day',
      date: { iso: '2026-10-27T15:00:00.000Z', label: 'October 27, 2026' },
      summary: null,
      thumbnail: null,
    },
  ],
  moreHref: '/news',
  ...overrides,
})

export const Default: Story = { args: { block: block(), baseLevel: 2 } }

/** Without a heading, the headlines take the block's own level. */
export const WithoutAHeading: Story = { args: { block: block({ heading: null }), baseLevel: 2 } }
