import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DEVICE,
  DEVICE_TABS,
  deviceWidth,
  firstDevice,
  fitZoom,
  PREVIEW_BREAKPOINTS,
} from '@/admin/LivePreview/device-tabs'

/**
 * Live Preview's device tabs (Jason, 2026-11-12): Mobile, Tablet, Desktop and Responsive, to click
 * through and see the page at each, opening on Desktop. PURE — the control is `DeviceTabs.tsx`.
 */

describe('the tabs', () => {
  it('are Mobile, Tablet, Desktop, Responsive, in that order', () => {
    expect(DEVICE_TABS.map((t) => t.label)).toEqual(['Mobile', 'Tablet', 'Desktop', 'Responsive'])
  })

  it('name Payload’s breakpoints — Responsive is Payload’s own', () => {
    expect(DEVICE_TABS.map((t) => t.name)).toEqual(['mobile', 'tablet', 'desktop', 'responsive'])
    expect(PREVIEW_BREAKPOINTS.map((b) => b.name)).toEqual(['mobile', 'tablet', 'desktop'])
  })

  it('give each device a real size', () => {
    expect(PREVIEW_BREAKPOINTS).toEqual([
      { label: 'Mobile', name: 'mobile', width: 375, height: 667 },
      { label: 'Tablet', name: 'tablet', width: 768, height: 1024 },
      { label: 'Desktop', name: 'desktop', width: 1280, height: 800 },
    ])
  })
})

describe('firstDevice — opening on Desktop', () => {
  it('is Desktop', () => {
    expect(DEFAULT_DEVICE).toBe('desktop')
  })

  it('moves Payload’s opening Responsive to Desktop, once', () => {
    expect(firstDevice('responsive', false)).toBe('desktop')
  })

  it('leaves a choice already made alone — including choosing Responsive', () => {
    expect(firstDevice('responsive', true)).toBeNull()
    expect(firstDevice('tablet', false)).toBeNull()
  })
})

describe('fitZoom — the whole device in the pane (Jason, 2026-11-12)', () => {
  it('shrinks a device wider than the pane until it fits, leaving room at the edges', () => {
    // 800px of pane, less 32px of margin, for a 1280px desktop: 768 / 1280 = 0.6.
    expect(fitZoom(800, 1280)).toBe(0.6)
    expect(fitZoom(600, 768)).toBe(0.73)
  })

  it('never enlarges: a device that fits is shown at its own size', () => {
    expect(fitZoom(1600, 1280)).toBe(1)
    expect(fitZoom(800, 375)).toBe(1)
  })

  it('is its own size when there is nothing to measure, or no device width (Responsive)', () => {
    expect(fitZoom(0, 1280)).toBe(1)
    expect(fitZoom(800, null)).toBe(1)
  })
})

describe('deviceWidth', () => {
  it('is each device’s width, and none for Responsive', () => {
    expect(deviceWidth('mobile')).toBe(375)
    expect(deviceWidth('tablet')).toBe(768)
    expect(deviceWidth('desktop')).toBe(1280)
    expect(deviceWidth('responsive')).toBeNull()
  })
})
