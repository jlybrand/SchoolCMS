import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { ChildPageNavBlock, PageLink } from '@/content/types'

import { ChildPageNav } from './ChildPageNav'

/**
 * The section menu (`03` §3.1).
 *
 * The `pages` arg is what the content layer resolves from the page's own children — the block
 * itself stores only a heading, so these stories are also the demonstration that the component
 * renders exactly what it is handed and fetches nothing (CLAUDE.md rule 1).
 *
 * There is no empty story on purpose: the component renders null when a page has no children,
 * and the component axe gate waits for `#storybook-root` to have a child, so a story that
 * renders nothing hangs the gate for its full timeout.
 */
const meta = {
  title: 'Blocks/ChildPageNav',
  component: ChildPageNav,
} satisfies Meta<typeof ChildPageNav>

export default meta

type Story = StoryObj<typeof meta>

const block = (overrides: Partial<ChildPageNavBlock> = {}): ChildPageNavBlock => ({
  kind: 'childPageNav',
  id: 'section',
  heading: 'In this section',
  ...overrides,
})

/** Already in title order, as `src/content/pages.ts` returns them. */
const PAGES: PageLink[] = [
  { id: '1', title: 'Bell schedule', path: '/about/bell-schedule' },
  { id: '2', title: 'Our history', path: '/about/our-history' },
  { id: '3', title: 'Principal’s message', path: '/about/principals-message' },
  { id: '4', title: 'Staff directory', path: '/about/staff-directory' },
]

export const Default: Story = {
  args: { block: block(), pages: PAGES, baseLevel: 2 },
}

/**
 * Without a heading the landmark still has a name — "In this section" — so it can be told
 * apart from the language switcher the page template renders.
 */
export const WithoutAHeading: Story = {
  args: { block: block({ heading: null }), pages: PAGES, baseLevel: 2 },
}

/** One child is a menu of one. There is no threshold below which the block hides itself. */
export const OneChild: Story = {
  args: { block: block(), pages: PAGES.slice(0, 1), baseLevel: 2 },
}

/**
 * Long titles wrap rather than truncating. A truncated page title is a link whose destination
 * the reader cannot identify (WCAG 2.4.4), which is worse than two lines.
 */
export const LongTitles: Story = {
  args: {
    block: block({ heading: 'Enrollment and registration' }),
    pages: [
      {
        id: '1',
        title: 'Kindergarten registration for the 2026–2027 school year',
        path: '/enroll/kindergarten',
      },
      {
        id: '2',
        title: 'Transfer requests and the intra-district transfer window',
        path: '/enroll/transfers',
      },
    ],
    baseLevel: 2,
  },
}
