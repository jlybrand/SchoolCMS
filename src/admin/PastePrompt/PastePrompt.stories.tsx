import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { PastePrompt } from './PastePrompt'

/**
 * The prompt is the project's first custom admin React, and CLAUDE.md's TDD exception table
 * puts it on the build-then-lock path rather than the test-first one. These stories are half
 * of that lock: `tests/a11y/storybook.spec.ts` runs axe over every one of them in both
 * directions, so the dialog is in the component gate before any author sees it.
 *
 * The other half is `tests/e2e/paste-normalizer.spec.ts`, which drives the real editor.
 *
 * Rejection copy is quoted from `REJECTION_MESSAGES` in the normalizer rather than imported,
 * because a story that renders whatever the module currently says cannot show the wording
 * changing. The e2e spec asserts the real strings.
 */
const meta = {
  title: 'Admin/PastePrompt',
  component: PastePrompt,
  args: { open: true, onResolve: () => {} },
} satisfies Meta<typeof PastePrompt>

export default meta

type Story = StoryObj<typeof meta>

const TABLE_REMOVED = {
  kind: 'table' as const,
  count: 1,
  message:
    'We removed a table. Tables are hard to read on a phone and hard to follow with a screen reader. Put the information in a list instead, or ask the district team if this really needs to be a table.',
}

const IMAGE_REMOVED = {
  kind: 'image' as const,
  count: 1,
  message:
    'We removed an image. Add images with the Insert an image button instead — it asks you to describe the picture for people who cannot see it, and a pasted image skips that step.',
}

const AGENDA_HEADINGS = [
  { blockIndex: 0, text: 'PTO Meeting Agenda' },
  { blockIndex: 2, text: 'Standing Items' },
  { blockIndex: 4, text: 'New Business' },
  { blockIndex: 6, text: 'Meeting Dates' },
]

/** A Word agenda: a layout table, a logo, and four bold lines standing in for headings. */
export const RemovalsAndHeadings: Story = {
  args: { rejections: [TABLE_REMOVED, IMAGE_REMOVED], candidates: AGENDA_HEADINGS },
}

/** Nothing was removed, so the title does not claim anything was cleaned up. */
export const HeadingsOnly: Story = {
  args: { rejections: [], candidates: [{ blockIndex: 0, text: 'Supply List' }] },
}

/**
 * Nothing to decide — one button, and it says what happens next rather than "OK".
 */
export const RemovalsOnly: Story = {
  args: { rejections: [IMAGE_REMOVED], candidates: [] },
}

/**
 * A long candidate line, at the 80-character limit the normalizer allows.
 *
 * Included because this is where the dialog's own layout is most likely to break, and where
 * an RTL run shows a physical property that slipped past stylelint.
 */
export const LongCandidate: Story = {
  args: {
    rejections: [],
    candidates: [
      {
        blockIndex: 0,
        text: 'Registration, Immunization Records and First Day Paperwork for New Families',
      },
    ],
  },
}
