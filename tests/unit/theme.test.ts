import { describe, expect, it } from 'vitest'

import { toTheme } from '@/content/theme-tokens'
import { REQUIRED_CONTRAST_PAIRS, checkContrastPairs, contrastRatio } from '@/lib/contrast'
import {
  BRAND_TEXT_PAIRS,
  DEFAULT_COLOR_TOKENS,
  THEME_FIELDS,
  brandFillTokens,
  brandTextWarnings,
  checkThemeColors,
  describeBrandWarnings,
  describeThemeFailures,
  textOn,
  toHexColor,
} from '@/lib/theme'

import { readRootTokens } from '../helpers/tokens'

/**
 * Per-tenant theme validation (`02` §4.4, `07` §3).
 *
 * A school may pick ANY brand color (Jason, 2026-11-18). What it is used FOR decides the rest:
 *   - on a FILL (buttons, the skip link, today's date) the text on it, its hover and the focus
 *     ring are DERIVED — white or black, whichever reads — so every fill pair passes, whatever
 *     the color. The sweep below proves it against the same manifest the token suite runs.
 *   - as TEXT (links) the color is the school's choice; AA depends on size and weight, which
 *     Jason judges. Under 4.5:1 the form WARNS (`brandTextWarnings`) — it no longer refuses.
 */

describe('DEFAULT_COLOR_TOKENS', () => {
  const css = readRootTokens()

  it('mirrors tokens.css exactly — for every token a contrast pair names', () => {
    /**
     * A tenant overrides one color; every pair it appears in is judged against the
     * platform's OTHER colors, so production needs their values without parsing CSS. This
     * is the drift guard that makes a TypeScript mirror honest: change `tokens.css` alone
     * and this fails.
     */
    const named = new Set(
      REQUIRED_CONTRAST_PAIRS.flatMap((pair) => [pair.foreground, pair.background]),
    )

    expect(Object.keys(DEFAULT_COLOR_TOKENS).sort()).toEqual([...named].sort())
    for (const token of named) {
      expect(DEFAULT_COLOR_TOKENS[token], token).toBe(css[token])
    }
  })

  it('every themeable field targets a token the stylesheet declares', () => {
    // A field pointed at a misspelt token would save, validate, render — and change nothing.
    for (const { token } of Object.values(THEME_FIELDS)) {
      expect(css[token], token).toBeDefined()
    }
  })

  it('a school has a primary and a secondary color, and nothing else', () => {
    expect(THEME_FIELDS).toEqual({
      primaryColor: { token: '--color-brand' },
      secondaryColor: { token: '--color-accent' },
    })
  })
})

describe('toHexColor', () => {
  it.each([
    ['#0f4c81', '#0f4c81'],
    ['#0F4C81', '#0f4c81'],
    ['  #0f4c81 ', '#0f4c81'],
    // Expanded, so one color has one spelling in the database and in the markup.
    ['#abc', '#aabbcc'],
  ])('normalizes %j', (input, expected) => {
    expect(toHexColor(input)).toBe(expected)
  })

  it.each([
    ['0f4c81'],
    ['#0f4c8'],
    ['#0f4c81ff'],
    ['navy'],
    ['rgb(15, 76, 129)'],
    ['var(--color-text)'],
    // The value lands in a style attribute. Anything that is not six hex digits is not a color.
    ['#0f4c81;background:url(https://evil.example)'],
    ['#0f4c81}</style><script>'],
    [''],
    [null],
    [undefined],
    [0x0f4c81],
  ])('refuses %j', (input) => {
    expect(toHexColor(input)).toBeNull()
  })
})

describe('checkThemeColors — refuses only what is not a color (Jason, 2026-11-18)', () => {
  it('accepts any color as the main one — #1e891e, school-bus yellow, white', () => {
    for (const primaryColor of ['#1e891e', '#ffcc00', '#ffffff', '#000000', '#0f4c81'])
      expect(checkThemeColors({ primaryColor }), primaryColor).toEqual([])
  })

  it('accepts any second color', () => {
    expect(checkThemeColors({ secondaryColor: '#ffcc00' })).toEqual([])
  })

  it('refuses a value that is not a color, on either field', () => {
    for (const value of ['blue', '#12345', '#0f4c81;background:red', 'rgb(0,0,0)'])
      for (const field of ['primaryColor', 'secondaryColor'] as const)
        expect(checkThemeColors({ [field]: value }), `${field} ${value}`).toHaveLength(1)
  })

  it('ignores absent and empty overrides — they mean "use the default"', () => {
    expect(checkThemeColors({})).toEqual([])
    expect(checkThemeColors({ primaryColor: null, secondaryColor: '' })).toEqual([])
  })
})

describe('describeThemeFailures', () => {
  it('names a malformed value as malformed, with an example', () => {
    expect(describeThemeFailures(checkThemeColors({ primaryColor: 'blue' }))).toBe(
      'Enter the color as a # followed by six letters or numbers, like #0f4c81.',
    )
    expect(describeThemeFailures([])).toBe('')
  })
})

describe('textOn — the text that reads on a fill', () => {
  it('white on a dark fill, black on a light one', () => {
    expect(textOn('#0f4c81')).toBe('#ffffff')
    expect(textOn('#ffcc00')).toBe('#000000')
    expect(textOn('#1e891e')).toBe('#000000')
  })

  it('reaches 4.5:1 on EVERY fill — pure black is why: near-black tops out near 4.2:1', () => {
    for (let v = 0; v <= 255; v += 5) {
      for (const hex of [
        gray(v),
        rgb(v, 0, 0),
        rgb(0, v, 0),
        rgb(0, 0, v),
        rgb(v, v, 0),
        rgb(0, v, v),
      ]) {
        expect(contrastRatio(textOn(hex), hex), hex).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('brandFillTokens — everything that sits ON the brand color, derived', () => {
  it('a dark brand: white text, a dark hover, a white focus ring', () => {
    expect(brandFillTokens('#0f4c81')).toEqual({
      '--color-brand-contrast': '#ffffff',
      '--color-brand-hover': '#14171c',
      '--focus-ring-color-on-brand': '#ffffff',
    })
  })

  it('a light brand: black text, a LIGHTER hover (more contrast, not less), a black ring', () => {
    const tokens = brandFillTokens('#ffcc00')
    expect(tokens['--color-brand-contrast']).toBe('#000000')
    expect(tokens['--focus-ring-color-on-brand']).toBe('#000000')
    const hover = tokens['--color-brand-hover']!
    expect(contrastRatio('#000000', hover)).toBeGreaterThan(contrastRatio('#000000', '#ffcc00'))
  })

  it('THE GUARANTEE: with any brand color, every pair except brand-as-link-text passes', () => {
    const notText = REQUIRED_CONTRAST_PAIRS.filter((pair) => !BRAND_TEXT_PAIRS.includes(pair.label))
    for (let v = 0; v <= 255; v += 15) {
      for (const brand of [
        gray(v),
        rgb(v, 0, 0),
        rgb(0, v, 0),
        rgb(0, 0, v),
        rgb(255, v, 0),
        '#1e891e',
      ]) {
        const tokens: Record<string, string> = {
          ...DEFAULT_COLOR_TOKENS,
          '--color-brand': brand,
          ...brandFillTokens(brand),
        }
        expect(
          checkContrastPairs(notText, (token) => tokens[token]!),
          brand,
        ).toEqual([])
      }
    }
  })
})

describe('brandTextWarnings — a warning, never a refusal', () => {
  it('none for a color that reads as link text on every surface', () => {
    expect(brandTextWarnings({ primaryColor: '#0f4c81' })).toEqual([])
    expect(brandTextWarnings({})).toEqual([])
    expect(brandTextWarnings({ primaryColor: 'blue' })).toEqual([])
  })

  it('#1e891e: fine on white, under 4.5:1 on the raised surface — and says so', () => {
    const warnings = brandTextWarnings({ primaryColor: '#1e891e' })
    expect(warnings.map((w) => w.label)).toEqual(['link text on raised surface'])
    expect(warnings[0]!.ratio).toBeLessThan(4.5)
    expect(warnings[0]!.ratio).toBeGreaterThan(4)
  })

  it('the warning in plain words: the numbers, and that large or bold text needs only 3:1', () => {
    const text = describeBrandWarnings(brandTextWarnings({ primaryColor: '#ffcc00' }))
    expect(text).toContain('normal-size text')
    expect(text).toContain('3:1')
    expect(text).toMatch(/\d\.\d:1/)
    expect(describeBrandWarnings([])).toBe('')
  })
})

describe('toTheme', () => {
  it('maps a color and DERIVES what sits on it', () => {
    expect(toTheme({ id: 1, tenant: 2, primaryColor: '#7A1F2B' })).toEqual({
      tokens: { '--color-brand': '#7a1f2b', ...brandFillTokens('#7a1f2b') },
    })
  })

  it.each([
    [null],
    [undefined],
    [{}],
    ['theme'],
    [[]],
    [{ primaryColor: null }],
    [{ primaryColor: '' }],
  ])('yields no overrides for %j — a tenant with no theme renders the default palette', (doc) => {
    expect(toTheme(doc)).toEqual({ tokens: {} })
  })

  it('serves a low-contrast color — the school’s choice (Jason, 2026-11-18)', () => {
    expect(toTheme({ primaryColor: '#1e891e' }).tokens['--color-brand']).toBe('#1e891e')
    expect(toTheme({ primaryColor: '#ffcc00' }).tokens['--color-brand-contrast']).toBe('#000000')
  })

  it('drops a value that is not a color — nothing unsafe reaches a style attribute', () => {
    expect(toTheme({ primaryColor: '#0f4c81;background:red' })).toEqual({ tokens: {} })
  })

  it('maps both colors', () => {
    expect(toTheme({ primaryColor: '#14532d', secondaryColor: '#FC0' }).tokens).toMatchObject({
      '--color-brand': '#14532d',
      '--color-accent': '#ffcc00',
    })
  })

  it('a secondary color alone is a theme, and derives nothing', () => {
    expect(toTheme({ secondaryColor: '#ffcc00' })).toEqual({
      tokens: { '--color-accent': '#ffcc00' },
    })
  })

  it('emits only known custom properties — no field on the row can name its own', () => {
    const theme = toTheme({ primaryColor: '#7a1f2b', '--color-surface': '#000000', extra: '#000' })
    expect(Object.keys(theme.tokens).sort()).toEqual(
      ['--color-brand', ...Object.keys(brandFillTokens('#7a1f2b'))].sort(),
    )
  })
})

const hex2 = (n: number) => n.toString(16).padStart(2, '0')
function rgb(r: number, g: number, b: number) {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}
function gray(v: number) {
  return rgb(v, v, v)
}
