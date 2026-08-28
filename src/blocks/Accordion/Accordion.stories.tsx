import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { AccordionBlock, RichText } from '@/content/types'

import { Accordion } from './Accordion'

/**
 * Every story enters the axe gate in both directions (`tests/a11y/storybook.spec.ts`). For
 * this block that gate is doing real work: the disclosure marker, the focus ring on
 * `<summary>`, and the answer's inline indent all have to survive the RTL pass.
 *
 * The stories render CLOSED, which is the state a visitor meets first. Chromium's axe run
 * still sees the answers in the DOM, so their contrast and link names are checked too.
 */
const meta = {
  title: 'Blocks/Accordion',
  component: Accordion,
} satisfies Meta<typeof Accordion>

export default meta

type Story = StoryObj<typeof meta>

const answer = (value: string): RichText => [
  { kind: 'paragraph', children: [{ kind: 'text', text: value, marks: [] }] },
]

const block = (overrides: Partial<AccordionBlock> = {}): AccordionBlock => ({
  kind: 'accordion',
  id: 'faq',
  heading: 'Transportation questions',
  items: [
    {
      heading: 'When does the bus run?',
      content: answer('Routes begin at 6:45 a.m. and are published the week before school starts.'),
    },
    {
      heading: 'What happens in bad weather?',
      content: answer('Delays are announced by 6:00 a.m. Routes run on the two-hour schedule.'),
    },
    {
      heading: 'We are moving mid-year. What do we do?',
      content: answer('Tell the front office so the route can be updated before you move.'),
    },
  ],
  ...overrides,
})

export const Default: Story = {
  args: { block: block(), baseLevel: 2 },
}

/** Without a set heading the questions are the block's top level — no skipped level. */
export const WithoutASetHeading: Story = {
  args: { block: block({ heading: null }), baseLevel: 2 },
}

/** An answer's own headings sit below the question they belong to. */
export const WithAStructuredAnswer: Story = {
  args: {
    block: block({
      heading: null,
      items: [
        {
          heading: 'What do we need to register?',
          content: [
            {
              kind: 'heading',
              level: 2,
              children: [{ kind: 'text', text: 'Documents', marks: [] }],
            },
            {
              kind: 'list',
              ordered: false,
              items: [
                { children: [{ kind: 'text', text: 'Proof of residence', marks: [] }], list: null },
                {
                  children: [{ kind: 'text', text: 'Immunization record', marks: [] }],
                  list: null,
                },
              ],
            },
          ],
        },
      ],
    }),
    baseLevel: 2,
  },
}

export const NestedInAnOutline: Story = {
  args: { block: block(), baseLevel: 4 },
}
