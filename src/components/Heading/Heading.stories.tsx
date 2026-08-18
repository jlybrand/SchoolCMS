import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Heading } from './Heading'
import { nextHeadingLevel } from './levels'
import type { HeadingLevel } from './levels'

const meta = {
  title: 'Foundation/Heading',
  component: Heading,
  args: { children: 'Board of Trustees meeting' },
} satisfies Meta<typeof Heading>

export default meta

type Story = StoryObj<typeof meta>

export const PageTitle: Story = { args: { level: 1 } }

export const SectionTitle: Story = { args: { level: 2 } }

export const Subsection: Story = { args: { level: 3 } }

/**
 * The case that justifies separating size from level: an `h4` deep in an outline that still
 * has to read as a section title. Without this, the only way to get the right appearance
 * would be to render a bigger heading element — a heading-order violation.
 */
export const LevelAndSizeDiverge: Story = {
  args: { level: 4, size: '2xl' },
}

/** The full outline, as a template threads it down. */
export const Outline: Story = {
  args: { level: 1 },
  render: () => (
    <>
      {([1, 2, 3, 4, 5, 6] as HeadingLevel[]).map((level) => (
        <Heading key={level} level={level}>
          {`Level ${level} — next nested level is ${nextHeadingLevel(level)}`}
        </Heading>
      ))}
    </>
  ),
}
