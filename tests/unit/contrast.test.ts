import { describe, expect, it } from 'vitest'

import {
  CONTRAST_MINIMUMS,
  checkContrastPairs,
  contrastRatio,
  parseHexColor,
  relativeLuminance,
} from '@/lib/contrast'

/**
 * Contrast maths (`07` §3).
 *
 * This is the function that makes "contrast is validated at token level" true rather than
 * aspirational: the token suite (`tests/unit/tokens.test.ts`) runs it over the shipped
 * defaults, and the per-tenant `theme` global runs the same function over a school's chosen
 * palette in Phase 4. Both callers depend on the maths being right, so it is tested against
 * known WCAG values rather than against itself.
 */

describe('parseHexColor', () => {
  it('parses six-digit hex', () => {
    expect(parseHexColor('#0f4c81')).toEqual({ r: 15, g: 76, b: 129 })
  })

  it('parses three-digit shorthand by doubling each nibble', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHexColor('#08f')).toEqual({ r: 0, g: 136, b: 255 })
  })

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(parseHexColor('  #0F4C81 ')).toEqual({ r: 15, g: 76, b: 129 })
  })

  it('returns null for anything it cannot evaluate', () => {
    // Named colors, rgb() and hsl() are not accepted: the point of this module is a
    // definite answer, and a parser that guesses is worse than one that refuses.
    expect(parseHexColor('rebeccapurple')).toBeNull()
    expect(parseHexColor('rgb(15 76 129)')).toBeNull()
    expect(parseHexColor('#12345')).toBeNull()
    expect(parseHexColor('')).toBeNull()
  })

  it('returns null for hex with alpha', () => {
    // Contrast against a translucent color depends on what is behind it, which a token
    // cannot know. Rejecting is honest; compositing against an assumed backdrop is not.
    expect(parseHexColor('#0f4c8180')).toBeNull()
  })
})

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBe(1)
  })

  it('weights green most heavily', () => {
    const green = relativeLuminance({ r: 0, g: 255, b: 0 })
    const red = relativeLuminance({ r: 255, g: 0, b: 0 })
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 })
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })
})

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })

  it('is 1:1 for a color against itself', () => {
    expect(contrastRatio('#0f4c81', '#0f4c81')).toBeCloseTo(1, 5)
  })

  it('is symmetric — order of arguments does not change the ratio', () => {
    expect(contrastRatio('#0f4c81', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#0f4c81'), 10)
  })

  it('matches published values for known pairs', () => {
    // #767676 on white is the canonical "exactly AA body text" grey; #595959 the "exactly
    // AAA" one. Both are widely published, so a regression in the luminance curve — the
    // easiest thing here to get subtly wrong — shows up as a failure rather than as a
    // plausible number.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(contrastRatio('#595959', '#ffffff')).toBeCloseTo(7.0, 2)
  })

  it('throws on an unparseable color rather than returning a passing number', () => {
    // Failing loudly matters here: a silent 21:1 for a typo'd token would report
    // conformance the platform does not have.
    expect(() => contrastRatio('not-a-color', '#ffffff')).toThrow(/not-a-color/)
  })
})

describe('CONTRAST_MINIMUMS', () => {
  it('encodes the AA thresholds', () => {
    // 1.4.3 body text, 1.4.3 large text, 1.4.11 non-text (UI boundaries, focus indicators).
    expect(CONTRAST_MINIMUMS).toEqual({ bodyText: 4.5, largeText: 3, nonText: 3 })
  })
})

describe('checkContrastPairs', () => {
  const resolve = (token: string) =>
    ({
      '--ok-fg': '#14171c',
      '--ok-bg': '#ffffff',
      '--faint': '#d3d7de',
      '--broken': 'var(--something-else)',
    })[token]

  it('returns no failures when every pair meets its requirement', () => {
    expect(
      checkContrastPairs(
        [
          {
            label: 'text on surface',
            foreground: '--ok-fg',
            background: '--ok-bg',
            requirement: 'bodyText',
          },
        ],
        resolve,
      ),
    ).toEqual([])
  })

  it('reports the ratio and the requirement for an insufficient pair', () => {
    const failures = checkContrastPairs(
      [
        {
          label: 'hairline on surface',
          foreground: '--faint',
          background: '--ok-bg',
          requirement: 'nonText',
        },
      ],
      resolve,
    )

    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      label: 'hairline on surface',
      reason: 'insufficient-contrast',
      required: 3,
    })
    expect(failures[0]?.ratio).toBeLessThan(3)
  })

  it('reports a missing token as a failure, never as a pass', () => {
    const failures = checkContrastPairs(
      [
        {
          label: 'renamed token',
          foreground: '--gone',
          background: '--ok-bg',
          requirement: 'bodyText',
        },
      ],
      resolve,
    )

    expect(failures).toEqual([
      expect.objectContaining({ label: 'renamed token', reason: 'unresolved-token' }),
    ])
  })

  it('reports an unevaluable value as a failure, never as a pass', () => {
    // A token pointing at another var cannot be evaluated without a full cascade. The
    // checker says so instead of skipping the pair, which would silently shrink the gate.
    const failures = checkContrastPairs(
      [
        {
          label: 'indirect token',
          foreground: '--broken',
          background: '--ok-bg',
          requirement: 'bodyText',
        },
      ],
      resolve,
    )

    expect(failures).toEqual([
      expect.objectContaining({ label: 'indirect token', reason: 'unevaluable-color' }),
    ])
  })

  it('checks every pair rather than stopping at the first failure', () => {
    const failures = checkContrastPairs(
      [
        { label: 'a', foreground: '--faint', background: '--ok-bg', requirement: 'nonText' },
        { label: 'b', foreground: '--gone', background: '--ok-bg', requirement: 'bodyText' },
      ],
      resolve,
    )

    expect(failures.map((f) => f.label)).toEqual(['a', 'b'])
  })
})
