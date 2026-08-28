import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { EmbedBlock } from '@/content/types'

import { Embed } from './Embed'

/**
 * A third-party video (`03` §3.1, `07` §6).
 *
 * ============================================================================
 * THE FRAME SOURCE IS `about:blank` IN EVERY STORY, DELIBERATELY.
 * ============================================================================
 *
 * These stories are the fixtures for the component axe gate, which runs in real Chromium on
 * every PR. A live `youtube-nocookie.com` URL here would make that gate depend on YouTube
 * being reachable from a CI runner — a third party's uptime deciding whether this repo's
 * accessibility gate passes.
 *
 * Nothing is lost by pointing it elsewhere. Everything this component is responsible for is
 * outside the frame: its `title`, its ratio, and the visible fallback link. What is INSIDE the
 * frame is the vendor's conformance, which axe cannot see across origins anyway and which
 * `07` §6 tracks through a VPAT rather than through a test.
 *
 * The real URL shape is pinned by `tests/unit/embed-url.test.ts`, where it belongs.
 */
const meta = {
  title: 'Blocks/Embed',
  component: Embed,
} satisfies Meta<typeof Embed>

export default meta

type Story = StoryObj<typeof meta>

const block = (overrides: Partial<EmbedBlock> = {}): EmbedBlock => ({
  kind: 'embed',
  id: 'video',
  src: 'about:blank',
  href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Board meeting, 12 August 2026',
  ...overrides,
})

export const Default: Story = {
  args: { block: block() },
}

/**
 * A long title wraps rather than truncating — it is both the frame's accessible name and the
 * fallback link's text, and a truncated link is one whose destination the reader cannot
 * identify (WCAG 2.4.4).
 */
export const LongTitle: Story = {
  args: {
    block: block({
      title:
        'Superintendent’s update on the 2026–2027 calendar, transportation changes and the spring bond referendum',
    }),
  },
}
