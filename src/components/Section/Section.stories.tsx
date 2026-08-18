import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { nextHeadingLevel } from '../Heading'

import { Section } from './Section'

const meta = {
  title: 'Foundation/Section',
  component: Section,
} satisfies Meta<typeof Section>

export default meta

type Story = StoryObj<typeof meta>

export const Titled: Story = {
  args: {
    level: 2,
    heading: 'Upcoming events',
    headingId: 'upcoming-events',
    children: <p>A landmark, named by reference to the heading above.</p>,
  },
}

/** No heading, so no landmark — an unnamed region is noise in the landmark list. */
export const Untitled: Story = {
  args: {
    level: 2,
    children: <p>Rendered as a plain wrapper, with no region role.</p>,
  },
}

export const Nested: Story = {
  args: { level: 2, heading: 'Athletics', headingId: 'athletics', children: null },
  render: (args) => (
    <Section {...args} heading="Athletics" headingId="athletics">
      <p>Levels descend by one at each step, via `nextHeadingLevel`.</p>
      <Section level={nextHeadingLevel(2)} heading="Schedules" headingId="schedules">
        <p>Nested content.</p>
      </Section>
    </Section>
  ),
}
