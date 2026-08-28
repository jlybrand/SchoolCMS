import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { PageBlock } from '@/content/types'

import { BlockList } from './BlockList'

/**
 * A composed page's layout as an editor actually assembles it (`03` §3).
 *
 * This is the story that matters for the `03` §3.2 claim, and the reason it is worth an axe
 * run of its own rather than trusting the per-block stories: heading ORDER is a property of
 * blocks in sequence, not of any one block. `Reordered` below is the same content in a
 * different order, and the outline has to survive it.
 *
 * There is no empty story on purpose — `BlockList` renders null for an empty layout, and the
 * component axe gate waits for `#storybook-root` to have a child, so a story that renders
 * nothing hangs the gate for its full timeout.
 */
const meta = {
  title: 'Blocks/BlockList',
  component: BlockList,
} satisfies Meta<typeof BlockList>

export default meta

type Story = StoryObj<typeof meta>

const text = (value: string, marks: ('strong' | 'em')[] = []) =>
  ({ kind: 'text', text: value, marks }) as const

const INTRO: PageBlock = {
  kind: 'richText',
  id: 'intro',
  content: [
    { kind: 'heading', level: 2, children: [text('Registration is open')] },
    {
      kind: 'paragraph',
      children: [
        text('Families new to the district register once, online. Returning families confirm '),
        text('contact details', ['strong']),
        text(' each August.'),
      ],
    },
    { kind: 'heading', level: 3, children: [text('What you will need')] },
    {
      kind: 'list',
      ordered: false,
      items: [
        { children: [text('Proof of residence')], list: null },
        { children: [text('An immunization record')], list: null },
      ],
    },
  ],
}

const ACTION: PageBlock = {
  kind: 'callToAction',
  id: 'action',
  heading: 'Enroll for the 2026–27 year',
  text: 'Registration for new students closes on 15 August.',
  href: '/enroll',
  linkLabel: 'Start enrollment',
  newTab: false,
}

const OUTRO: PageBlock = {
  kind: 'richText',
  id: 'outro',
  content: [
    { kind: 'heading', level: 2, children: [text('If you need help')] },
    {
      kind: 'paragraph',
      children: [text('Call the district office and ask for the registrar.')],
    },
  ],
}

export const ComposedPage: Story = {
  args: { blocks: [INTRO, ACTION, OUTRO] },
}

/**
 * The same three blocks, reordered. The outline is identical — every block's own heading is
 * still an `h2` — because levels come from the page outline rather than from position. That
 * is what makes "an editor cannot produce a heading-order violation by reordering" a
 * structural property rather than a review checklist item.
 */
export const Reordered: Story = {
  args: { blocks: [ACTION, OUTRO, INTRO] },
}

/** A layout rendered inside an already-named region starts a step deeper. */
export const NestedInASection: Story = {
  args: { blocks: [INTRO, ACTION], baseLevel: 3 },
}
