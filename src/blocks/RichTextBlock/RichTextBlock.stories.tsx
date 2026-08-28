import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { RichTextPageBlock } from '@/content/types'

import { RichTextBlock } from './RichTextBlock'

/**
 * Prose within a composed page. It renders identically to a fixed-type page's `body` — same
 * nodes, same renderer — so this entry exists to put the BLOCK in the axe gate under its own
 * name (CLAUDE.md: every block ships with a Storybook entry), and to show the heading
 * contract at a nested level where a template author would otherwise have to reason about it.
 *
 * No empty story: `RichText` renders null for an empty document, and the component axe gate
 * waits for `#storybook-root` to have a child.
 */
const meta = {
  title: 'Blocks/RichTextBlock',
  component: RichTextBlock,
} satisfies Meta<typeof RichTextBlock>

export default meta

type Story = StoryObj<typeof meta>

const text = (value: string, marks: ('strong' | 'em')[] = []) =>
  ({ kind: 'text', text: value, marks }) as const

const block: RichTextPageBlock = {
  kind: 'richText',
  id: 'prose',
  content: [
    { kind: 'heading', level: 2, children: [text('Transportation')] },
    {
      kind: 'paragraph',
      children: [
        text('Bus routes are published the week before school starts. Families who move '),
        text('during', ['em']),
        text(' the year should tell the front office so the route can be updated.'),
      ],
    },
    { kind: 'heading', level: 3, children: [text('Inclement weather')] },
    {
      kind: 'list',
      ordered: false,
      items: [
        { children: [text('Delays are announced by 6:00 a.m.')], list: null },
        { children: [text('Routes run on the two-hour delay schedule')], list: null },
      ],
    },
  ],
}

export const Default: Story = {
  args: { block, baseLevel: 2 },
}

/**
 * The same content one step deeper in the outline: the author's top-level heading becomes an
 * `h3` and their sub-heading an `h4`. The author picked neither — the outline did.
 */
export const NestedInAnOutline: Story = {
  args: { block, baseLevel: 3 },
}
