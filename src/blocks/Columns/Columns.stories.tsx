import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { ResolvedColumnsBlock, ResolvedPageBlock } from '@/content/types'

import { BlockList } from '../BlockList'

/**
 * Columns (Jason, 2026-11-04), rendered through `BlockList` as a page renders them: the blocks
 * inside a column are the real ones, so the outline these stories produce is the outline a page
 * gets. The component axe gate runs each story left-to-right and right-to-left; in RTL the first
 * column sits on the right.
 *
 * The stories differ in which headings exist, because that is what moves every level inside
 * (`columnLevels`) — a set heading, column headings, both, neither.
 */
const meta = {
  title: 'Blocks/Columns',
  component: BlockList,
} satisfies Meta<typeof BlockList>

export default meta

type Story = StoryObj<typeof meta>

const text = (value: string, marks: ('strong' | 'em')[] = []) =>
  ({ kind: 'text', text: value, marks }) as const

const words = (id: string, value: string): ResolvedPageBlock => ({
  kind: 'richText',
  id,
  content: [{ kind: 'paragraph', children: [text(value)] }],
})

const VOLUNTEER: ResolvedPageBlock[] = [
  words('v1', 'Help in classrooms, on field trips and at the book fair.'),
  {
    kind: 'callToAction',
    id: 'v2',
    heading: 'Sign up to volunteer',
    text: null,
    href: '/volunteer',
    linkLabel: 'Volunteer sign-up',
    newTab: false,
  },
]

const PTA: ResolvedPageBlock[] = [
  words('p1', 'The PTA meets on the first Tuesday of each month in the library.'),
  {
    kind: 'cardGrid',
    id: 'p2',
    heading: null,
    cards: [
      { title: 'Meeting notes', text: 'Minutes from every meeting.', href: '/pta/notes' },
      { title: 'Fundraising', text: null, href: '/pta/fundraising' },
    ],
  },
]

const BOOSTERS: ResolvedPageBlock[] = [
  words('b1', 'Booster clubs support athletics and the arts all year.'),
  { kind: 'divider', id: 'b2' },
  words('b3', 'New members are welcome at any meeting.'),
]

const columns = (overrides: Partial<ResolvedColumnsBlock> = {}): ResolvedColumnsBlock => ({
  kind: 'columns',
  id: 'get-involved',
  heading: 'Get involved',
  columns: [
    { heading: 'Volunteer', blocks: VOLUNTEER },
    { heading: 'PTA', blocks: PTA },
  ],
  ...overrides,
})

const page = (block: ResolvedColumnsBlock) => ({ blocks: [block], childPages: [] })

/** A set heading and column headings: h2, then h3 per column, then the blocks inside from h4. */
export const TwoColumns: Story = { args: page(columns()) }

/** Three columns — side by side from 64rem, two then one below in between, stacked on a phone. */
export const ThreeColumns: Story = {
  args: page(
    columns({
      columns: [
        { heading: 'Volunteer', blocks: VOLUNTEER },
        { heading: 'PTA', blocks: PTA },
        { heading: 'Boosters', blocks: BOOSTERS },
      ],
    }),
  ),
}

/** No headings at all: the blocks in each column sit where the columns do. */
export const WithoutHeadings: Story = {
  args: page(
    columns({
      heading: null,
      columns: [
        { heading: null, blocks: VOLUNTEER },
        { heading: null, blocks: PTA },
      ],
    }),
  ),
}

/** One column left empty: the other stays where it was put. */
export const OneColumnEmpty: Story = {
  args: page(
    columns({
      columns: [
        { heading: 'Volunteer', blocks: VOLUNTEER },
        { heading: null, blocks: [] },
      ],
    }),
  ),
}
