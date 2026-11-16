import { describe, expect, it } from 'vitest'

import { toImageAsset } from '@/content/image-asset'

/**
 * A library image as a page shows it (Jason, 2026-11-13). Its alt text comes from the library —
 * never re-entered on a page — and is EMPTY for a decorative image (WCAG 1.1.1). `srcset` lists
 * the sizes Payload made, so a phone loads the small one.
 */

const doc = {
  id: 12,
  kind: 'image',
  url: '/api/resources/file/gym.png',
  width: 2400,
  height: 1600,
  alt: '  Students in the gym  ',
  isDecorative: false,
  sizes: {
    thumbnail: { url: '/api/resources/file/gym-400x267.webp', width: 400, height: 267 },
    card: { url: '/api/resources/file/gym-800x533.webp', width: 800, height: 533 },
    hero: { url: '/api/resources/file/gym-1600x1067.webp', width: 1600, height: 1067 },
  },
}

describe('toImageAsset', () => {
  it('the hero size as its source, every size in srcset, the library’s alt', () => {
    expect(toImageAsset(doc)).toEqual({
      src: '/api/resources/file/gym-1600x1067.webp',
      width: 1600,
      height: 1067,
      alt: 'Students in the gym',
      srcSet:
        '/api/resources/file/gym-400x267.webp 400w, /api/resources/file/gym-800x533.webp 800w, /api/resources/file/gym-1600x1067.webp 1600w, /api/resources/file/gym.png 2400w',
    })
  })

  it('a decorative image has empty alt text', () => {
    expect(toImageAsset({ ...doc, alt: 'ignored', isDecorative: true })?.alt).toBe('')
  })

  it('a small image Payload made no sizes for: the original alone', () => {
    expect(
      toImageAsset({ ...doc, width: 300, height: 200, sizes: { thumbnail: { url: null } } }),
    ).toEqual({
      src: '/api/resources/file/gym.png',
      width: 300,
      height: 200,
      alt: 'Students in the gym',
      srcSet: '/api/resources/file/gym.png 300w',
    })
  })

  it('not an image, or not a file at all: nothing', () => {
    expect(toImageAsset({ ...doc, kind: 'document' })).toBeNull()
    expect(toImageAsset({ ...doc, url: null })).toBeNull()
    expect(toImageAsset(null)).toBeNull()
  })
})
