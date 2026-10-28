import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { PublishedDate } from './PublishedDate'

/** The date line above an announcement and in news lists. */
const meta = {
  title: 'Components/PublishedDate',
  component: PublishedDate,
} satisfies Meta<typeof PublishedDate>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { iso: '2026-10-28T15:00:00.000Z', label: 'October 28, 2026' },
}

/** Formatted for the visitor's language upstream; the component only renders it. */
export const Spanish: Story = {
  args: { iso: '2026-10-28T15:00:00.000Z', label: '28 de octubre de 2026' },
}
