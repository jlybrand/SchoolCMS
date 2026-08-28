import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { CallToActionBlock } from '@/content/types'

import { CallToAction } from './CallToAction'

/**
 * Every story enters the axe gate in both writing directions
 * (`tests/a11y/storybook.spec.ts`). That is where this block's RTL claim is actually
 * checked: the accent border and the padding are logical properties, so the whole block
 * mirrors for Arabic without a direction-specific rule.
 */
const meta = {
  title: 'Blocks/CallToAction',
  component: CallToAction,
} satisfies Meta<typeof CallToAction>

export default meta

type Story = StoryObj<typeof meta>

const block = (overrides: Partial<CallToActionBlock> = {}): CallToActionBlock => ({
  kind: 'callToAction',
  id: 'cta',
  heading: 'Enroll for the 2026–27 year',
  text: 'Registration for new students closes on 15 August.',
  href: '/enroll',
  linkLabel: 'Start enrollment',
  newTab: false,
  ...overrides,
})

export const Default: Story = {
  args: { block: block(), baseLevel: 2 },
}

/**
 * The mapper keeps a call to action that lost its heading — the link is the block. There is
 * no story for one that lost its link, because the mapper drops that rather than rendering
 * a button-shaped element that goes nowhere.
 */
export const WithoutAHeading: Story = {
  args: { block: block({ heading: null, text: null }), baseLevel: 2 },
}

/** The notice lives in the accessible name only — inspect with a screen reader, not by eye. */
export const OpensInANewWindow: Story = {
  args: {
    block: block({
      heading: 'Update your family contact details',
      text: 'The form opens in the district portal.',
      href: 'https://forms.office.com/example',
      linkLabel: 'Open the contact form',
      newTab: true,
    }),
    baseLevel: 2,
  },
}

/**
 * Deep in a page outline the block owns an `h4` and still has to read as a section title —
 * which is why `Heading` separates level from size (`src/components/Heading/Heading.tsx`).
 */
export const NestedInAnOutline: Story = {
  args: { block: block(), baseLevel: 4 },
}
