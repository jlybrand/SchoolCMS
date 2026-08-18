import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { MAIN_CONTENT_ID, SkipLink } from './SkipLink'

const meta = {
  title: 'Foundation/SkipLink',
  component: SkipLink,
  args: { children: 'Skip to main content' },
} satisfies Meta<typeof SkipLink>

export default meta

type Story = StoryObj<typeof meta>

/**
 * Off-screen until focused — press Tab in the preview to see it.
 *
 * The visible state is the one worth looking at: it sits on a brand fill, so it is also the
 * component that proves `--focus-ring-color-inverse` earns its place (the default dark ring
 * scores 1.4:1 there).
 */
export const Default: Story = {
  render: (args) => (
    <>
      <SkipLink {...args} />
      <p>Press Tab. The link appears at the inline-start corner — top-right under RTL.</p>
      <main id={MAIN_CONTENT_ID}>
        <p>Skip target.</p>
      </main>
    </>
  ),
}
