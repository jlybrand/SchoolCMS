import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { ImageAsset, ResolvedImageBlock } from '@/content/types'

import { LibraryImage } from './LibraryImage'

/**
 * An image block, as the resolve pass hands it over (Jason, 2026-11-13). The picture is an
 * inline placeholder so Storybook needs no library files.
 */
const meta = {
  title: 'Blocks/Image',
  component: LibraryImage,
} satisfies Meta<typeof LibraryImage>

export default meta

type Story = StoryObj<typeof meta>

const PICTURE =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'><rect width='1600' height='900' fill='%232f5d8a'/><circle cx='520' cy='450' r='260' fill='%23c9a227'/></svg>"

const asset = (over: Partial<ImageAsset> = {}): ImageAsset => ({
  src: PICTURE,
  width: 1600,
  height: 900,
  alt: 'Students showing their volcano at the science fair',
  srcSet: `${PICTURE} 1600w`,
  ...over,
})

const block = (over: Partial<ResolvedImageBlock> = {}): ResolvedImageBlock => ({
  kind: 'image',
  id: 'image',
  image: asset(),
  caption: 'The science fair, in the gym.',
  ...over,
})

export const WithCaption: Story = { args: { block: block() } }

export const NoCaption: Story = { args: { block: block({ caption: null }) } }

/** Decorative: empty alt text, so a screen reader passes over it. */
export const Decorative: Story = {
  args: { block: block({ image: asset({ alt: '' }), caption: null }) },
}
