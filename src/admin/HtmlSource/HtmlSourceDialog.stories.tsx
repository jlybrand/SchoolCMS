import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { htmlToLexical, type SourceContext } from '@/lib/html-source'

import { HtmlSourceDialog } from './HtmlSourceDialog'

/**
 * Build-then-lock (CLAUDE.md's TDD exception table): each step of the dialog is in the component
 * axe gate (`tests/a11y/storybook.spec.ts`, LTR and RTL); `tests/e2e/text-features.spec.ts`
 * drives it in the real editor. The round trip itself is test-first, `tests/unit/html-source.test.ts`.
 */
const ctx: SourceContext = { images: new Map() }
const check = (code: string) => htmlToLexical(code, ctx)

const TEXT = [
  '<h2>Supply list</h2>',
  '<p>Bring these on <strong>Monday</strong>:</p>',
  '<ul>',
  '  <li>Pencils</li>',
  '  <li>A <a href="/dd2/pages/12">permission slip</a></li>',
  '</ul>',
].join('\n')

const meta = {
  title: 'Admin/HtmlSourceDialog',
  component: HtmlSourceDialog,
  args: { open: true, code: TEXT, check, onApply: () => {}, onClose: () => {} },
} satisfies Meta<typeof HtmlSourceDialog>

export default meta

type Story = StoryObj<typeof meta>

/** Opened from the toolbar: the text as HTML. */
export const TheText: Story = {}

/** An empty text opens an empty box. */
export const Empty: Story = { args: { code: '' } }

/** The code was edited and the check took things out: each named, then "Update with the rest". */
export const Report: Story = {
  args: {
    editedCode: `${TEXT}\n<p style="color:red">Sign up below</p><iframe src="https://forms.office.com/x"></iframe><script>track()</script>`,
  },
}

/** Nothing could be kept: only "Back to the code". */
export const NothingToKeep: Story = {
  args: { editedCode: '<iframe src="https://maps.google.com/x"></iframe>' },
}
