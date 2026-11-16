import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { ResolvedHeroBlock } from '@/content/types'

import { Hero } from './Hero'

/**
 * A hero, as the resolve pass hands it over (Jason, 2026-11-13). "Images will not always have a
 * heading": with words, they sit on a band under the image (beside it when wide); without, the
 * image alone. Inline placeholder picture.
 */
const meta = {
  title: 'Blocks/Hero',
  component: Hero,
} satisfies Meta<typeof Hero>

export default meta

type Story = StoryObj<typeof meta>

const PICTURE =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'><rect width='1600' height='900' fill='%232f5d8a'/><circle cx='1100' cy='420' r='300' fill='%23c9a227'/></svg>"

const block = (over: Partial<ResolvedHeroBlock> = {}): ResolvedHeroBlock => ({
  kind: 'hero',
  id: 'hero',
  image: {
    src: PICTURE,
    width: 1600,
    height: 900,
    alt: 'The front of the school on the first day',
    srcSet: `${PICTURE} 1600w`,
  },
  heading: 'Welcome to Southside High',
  subheading: 'Home of the Hawks.',
  href: '/enroll',
  linkLabel: 'Start enrollment',
  newTab: false,
  ...over,
})

export const Everything: Story = { args: { block: block(), baseLevel: 2 } }

export const ImageOnly: Story = {
  args: {
    block: block({ heading: null, subheading: null, href: null, linkLabel: null }),
    baseLevel: 2,
  },
}

export const HeadingOnly: Story = {
  args: { block: block({ subheading: null, href: null, linkLabel: null }), baseLevel: 2 },
}
