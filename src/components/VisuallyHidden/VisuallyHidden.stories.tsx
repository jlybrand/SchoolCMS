import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { VisuallyHidden } from './VisuallyHidden'

const meta = {
  title: 'Foundation/VisuallyHidden',
  component: VisuallyHidden,
} satisfies Meta<typeof VisuallyHidden>

export default meta

type Story = StoryObj<typeof meta>

/**
 * Nothing to see, by definition. The story exists so the component is in the axe run and so
 * the technique has one place to be reviewed: content that is announced but not painted.
 */
export const Default: Story = {
  args: { children: 'Announced to a screen reader, invisible on screen' },
  render: (args) => (
    <p>
      This sentence contains hidden text.
      <VisuallyHidden {...args} />
    </p>
  ),
}
