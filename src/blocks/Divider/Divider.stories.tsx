import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Divider } from './Divider'

/**
 * An `<hr>` — a thematic break, not a hidden decoration. It is in the axe gate under its own
 * name because a rule drawn with a border is a place a physical property slips in unnoticed.
 */
const meta = {
  title: 'Blocks/Divider',
  component: Divider,
} satisfies Meta<typeof Divider>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** In context: the break is what distinguishes this from the space `Stack` already provides. */
export const BetweenTwoSections: Story = {
  render: () => (
    <>
      <p>Registration for new students closes on 15 August.</p>
      <Divider />
      <p>Bus routes are published the week before school starts.</p>
    </>
  ),
}
