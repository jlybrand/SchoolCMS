import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Stack } from './Stack'

const meta = {
  title: 'Foundation/Stack',
  component: Stack,
  args: {
    children: (
      <>
        <p>First item.</p>
        <p>Second item.</p>
        <p>Third item.</p>
      </>
    ),
  },
} satisfies Meta<typeof Stack>

export default meta

type Story = StoryObj<typeof meta>

export const Medium: Story = { args: { space: 'md' } }

export const Extra: Story = { args: { space: 'xl' } }

export const Tight: Story = { args: { space: 'xs' } }
