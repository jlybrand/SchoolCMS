import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { RichText as RichTextDoc } from '@/content/types'

import { RichText } from './RichText'

/**
 * Every story enters the axe gate in both writing directions
 * (`tests/a11y/storybook.spec.ts`), which is where the RTL check on lists and links happens —
 * a padded list is the classic place a physical property slips past stylelint.
 */
const meta = {
  title: 'Foundation/RichText',
  component: RichText,
} satisfies Meta<typeof RichText>

export default meta

type Story = StoryObj<typeof meta>

const text = (value: string, marks: ('strong' | 'em')[] = []) =>
  ({ kind: 'text', text: value, marks }) as const

/** The shape a normalized Word agenda actually arrives in (`07` §4.2). */
const AGENDA: RichTextDoc = [
  { kind: 'heading', level: 2, children: [text('PTO Meeting Agenda')] },
  {
    kind: 'paragraph',
    children: [
      text('Thursday, September 18 — 6:30 p.m. in the media center. Please review '),
      text('last month’s notes', ['em']),
      text(' before you arrive.'),
    ],
  },
  { kind: 'heading', level: 3, children: [text('Standing Items')] },
  {
    kind: 'list',
    ordered: false,
    items: [
      { children: [text('Welcome and introductions')], list: null },
      { children: [text('Approval of the August minutes')], list: null },
      {
        children: [text('Treasurer’s report')],
        list: {
          kind: 'list',
          ordered: false,
          items: [{ children: [text('Fundraiser balance')], list: null }],
        },
      },
    ],
  },
  { kind: 'heading', level: 3, children: [text('New Business')] },
  {
    kind: 'list',
    ordered: true,
    items: [
      { children: [text('Fall fundraiser planning')], list: null },
      {
        children: [
          text('Volunteer checks — see '),
          {
            kind: 'link',
            href: 'https://www.dd2.example.org/volunteer',
            newTab: true,
            children: [text('the district volunteer page')],
          },
        ],
        list: null,
      },
    ],
  },
  {
    kind: 'paragraph',
    children: [text('Bring '), text('two forms of ID', ['strong']), text(' to sign in.')],
  },
]

export const Body: Story = { args: { content: AGENDA } }

/**
 * The same body one step deeper in the outline — inside a named `Section`, the author's
 * top-level heading has to render as an h3 or the page outline lies.
 */
export const NestedDeeper: Story = { args: { content: AGENDA, baseLevel: 3 } }

/**
 * NO EMPTY STORY, deliberately. `RichText` renders `null` for an empty body — correct, and
 * covered by `tests/unit/components/rich-text.test.tsx`. It cannot be a story: the axe gate
 * waits for `#storybook-root` to have a child before scanning, precisely so an empty root
 * cannot analyse clean and report conformance for nothing. A story that renders nothing hangs
 * that wait, and there is no accessibility question to ask about nothing anyway.
 */
