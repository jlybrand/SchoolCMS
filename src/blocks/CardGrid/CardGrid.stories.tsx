import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { CardGridBlock } from '@/content/types'

import { CardGrid } from './CardGrid'

/**
 * The grid is intrinsic — `auto-fit` plus `minmax`, no column count and no media query — so
 * the two- and seven-card stories below exercise the same rules at different widths. That is
 * also what makes 1.4.10 reflow hold at 320px and 400% zoom without a separate story.
 */
const meta = {
  title: 'Blocks/CardGrid',
  component: CardGrid,
} satisfies Meta<typeof CardGrid>

export default meta

type Story = StoryObj<typeof meta>

const block = (overrides: Partial<CardGridBlock> = {}): CardGridBlock => ({
  kind: 'cardGrid',
  id: 'programs',
  heading: 'Programs and activities',
  cards: [
    { title: 'Athletics', text: 'Fall sign-ups close 15 August.', href: '/athletics' },
    { title: 'Fine arts', text: 'Band, chorus, theatre and visual art.', href: '/arts' },
    { title: 'Clubs', text: 'Meeting times vary by school.', href: '/clubs' },
  ],
  ...overrides,
})

export const Default: Story = {
  args: { block: block(), baseLevel: 2 },
}

/** A card can be a labelled fact rather than a link — the title simply is not a link. */
export const MixedLinkedAndUnlinked: Story = {
  args: {
    block: block({
      cards: [
        { title: 'Athletics', text: 'Fall sign-ups close 15 August.', href: '/athletics' },
        { title: 'School hours', text: '7:45 a.m. to 2:45 p.m.', href: null },
        { title: 'Clubs', text: null, href: '/clubs' },
      ],
    }),
    baseLevel: 2,
  },
}

export const WithoutASetHeading: Story = {
  args: { block: block({ heading: null }), baseLevel: 2 },
}

/** Seven cards on the same rules — the grid reflows rather than being told a column count. */
export const ManyCards: Story = {
  args: {
    block: block({
      cards: Array.from({ length: 7 }, (_, index) => ({
        title: `Department ${index + 1}`,
        text: 'Contact the front office for details.',
        href: `/departments/${index + 1}`,
      })),
    }),
    baseLevel: 2,
  },
}
