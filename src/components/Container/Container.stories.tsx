import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Container } from './Container'

const meta = {
  title: 'Foundation/Container',
  component: Container,
} satisfies Meta<typeof Container>

export default meta

type Story = StoryObj<typeof meta>

const paragraph =
  'Dorchester District Two publishes board agendas, school calendars and staff directories ' +
  'across one district site and twenty-seven school sites. This paragraph exists to show ' +
  'where the reading measure caps a line, which is a legibility requirement rather than a ' +
  'stylistic preference — long lines cost the reader their place on every return sweep.'

export const Prose: Story = {
  args: { children: <p>{paragraph}</p> },
}

/** Gutters are logical, so both variants mirror under RTL with no second rule (`08` §7). */
export const Wide: Story = {
  args: { width: 'wide', children: <p>{paragraph}</p> },
}
