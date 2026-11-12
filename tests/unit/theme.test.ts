import { describe, expect, it } from 'vitest'

import { toTheme } from '@/content/theme-tokens'
import { REQUIRED_CONTRAST_PAIRS } from '@/lib/contrast'
import {
  DEFAULT_COLOR_TOKENS,
  THEME_FIELDS,
  checkThemeColors,
  describeThemeFailures,
  toHexColor,
} from '@/lib/theme'

import { readRootTokens } from '../helpers/tokens'

/**
 * Per-tenant theme validation (`02` §4.4, `07` §3).
 *
 * `07` §3 promises that "a school cannot pick a brand color that fails". This suite is that
 * promise: the same `checkContrastPairs` the token suite runs over the shipped palette, run
 * over a tenant's overrides laid on top of it — at save, and again at render.
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

describe('checkThemeColors', () => {
  it('passes an empty theme — the defaults are already valid', () => {
    expect(checkThemeColors({})).toEqual([])
  })

  it.each([['#0f4c81'], ['#7a1f2b'], ['#14532d'], ['#000000']])(
    'accepts %s as a brand color',
    (primaryColor) => {
      expect(checkThemeColors({ primaryColor })).toEqual([])
    },
  )

  it('refuses a school-bus yellow, and reports EVERY pair it breaks', () => {
    /**
     * The realistic failure: a school's actual brand color. It is link text, so it fails
     * on both surfaces, and it carries white text and a white focus ring, so it fails there
     * too. All at once — one-at-a-time correction of a palette is how a validator becomes
     * the thing people work around.
     */
    const failures = checkThemeColors({ primaryColor: '#ffcc00' })

    expect(failures.map((failure) => failure.label).sort()).toEqual([
      'focus ring on a brand fill',
      'link text on raised surface',
      'link text on surface',
      'text on a brand fill',
    ])
    expect(failures.every((failure) => failure.reason === 'insufficient-contrast')).toBe(true)
  })

  it('refuses a mid-tone that passes on white but not on the raised surface', () => {
    // 4.54:1 on #ffffff, 4.23:1 on #f6f7f9 — the header and footer sit on the raised one.
    const failures = checkThemeColors({ primaryColor: '#767676' })
    expect(failures.map((failure) => failure.label)).toEqual(['link text on raised surface'])
  })

  it('reports a value that is not a color as a failure, never as a pass', () => {
    const failures = checkThemeColors({ primaryColor: 'navy' })
    expect(failures.length).toBeGreaterThan(0)
    expect(failures.every((failure) => failure.reason === 'unevaluable-color')).toBe(true)
  })

  it.each([['#ffcc00'], ['#ffffff'], ['#000000'], ['#87ceeb']])(
    'accepts %s as a SECONDARY color — it is decorative, so nothing is read against it',
    (secondaryColor) => {
      /**
       * The accent is a rule under the header, never text and never behind text, which is
       * what lets a school's gold or sky blue be used at all (1.4.11 covers interactive
       * boundaries and meaningful graphics, not decoration). The day a component puts text on
       * it, that component adds a pair to `REQUIRED_CONTRAST_PAIRS` and this test changes.
       */
      expect(checkThemeColors({ primaryColor: '#14532d', secondaryColor })).toEqual([])
    },
  )

  it('still refuses a secondary color that is not a color — no pair names it, so this is explicit', () => {
    const failures = checkThemeColors({ secondaryColor: 'gold' })
    expect(failures.map((failure) => failure.reason)).toEqual(['unevaluable-color'])
    expect(failures[0]?.foreground).toBe('--color-accent')
  })

  it('a light color is refused as primary and accepted as secondary — the same gold', () => {
    expect(checkThemeColors({ primaryColor: '#ffcc00' }).length).toBeGreaterThan(0)
    expect(checkThemeColors({ secondaryColor: '#ffcc00' })).toEqual([])
  })

  it('ignores absent and empty overrides — they mean "use the default"', () => {
    expect(checkThemeColors({ primaryColor: null })).toEqual([])
    expect(checkThemeColors({ primaryColor: undefined })).toEqual([])
    expect(checkThemeColors({ primaryColor: '' })).toEqual([])
  })
})

describe('describeThemeFailures', () => {
  it('says what is wrong in plain words, with the numbers, and what to do', () => {
    const message = describeThemeFailures(checkThemeColors({ primaryColor: '#ffcc00' }))

    expect(message).toContain('darker')
    expect(message).toContain('link text on surface')
    expect(message).toMatch(/1\.\d+:1/)
    expect(message).toContain('4.5:1')
    // `04` §2.1 — nobody should have to know what a token is.
    expect(message).not.toContain('--color')
  })

  it('tells someone whose main color is light what to do about it', () => {
    /**
     * Green-and-gold is fine; gold-and-black is the case that needs words. The main color
     * is what links are drawn in, so the advice is to swap the two — not to give up.
     */
    const message = describeThemeFailures(checkThemeColors({ primaryColor: '#ffcc00' }))
    expect(message).toMatch(/second color/i)
  })

  it('names a malformed value as malformed', () => {
    expect(describeThemeFailures(checkThemeColors({ primaryColor: 'navy' }))).toContain('#')
  })
})

describe('toTheme', () => {
  it('maps a valid row to the custom properties it overrides', () => {
    expect(toTheme({ id: 1, tenant: 2, primaryColor: '#7A1F2B' })).toEqual({
      tokens: { '--color-brand': '#7a1f2b' },
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

  it('drops a palette that fails contrast, WHOLE — never serves it, never half of it', () => {
    /**
     * Validation tells the editor; this is what keeps a failing palette off the site when
     * the row arrived by a route that never ran it, or when a later platform change to the
     * neutrals turned a palette that passed into one that does not.
     */
    expect(toTheme({ primaryColor: '#ffcc00' })).toEqual({ tokens: {} })
    expect(toTheme({ primaryColor: '#0f4c81;background:red' })).toEqual({ tokens: {} })
  })

  it('maps both colors', () => {
    expect(toTheme({ primaryColor: '#14532d', secondaryColor: '#FC0' })).toEqual({
      tokens: { '--color-brand': '#14532d', '--color-accent': '#ffcc00' },
    })
  })

  it('a secondary color alone is a theme', () => {
    expect(toTheme({ secondaryColor: '#ffcc00' })).toEqual({
      tokens: { '--color-accent': '#ffcc00' },
    })
  })

  it('a failing primary takes a valid secondary down with it — a palette is judged as a set', () => {
    expect(toTheme({ primaryColor: '#ffcc00', secondaryColor: '#14532d' })).toEqual({ tokens: {} })
  })

  it('emits only known custom properties — no field on the row can name its own', () => {
    const theme = toTheme({ primaryColor: '#7a1f2b', '--color-surface': '#000000', extra: '#000' })
    expect(Object.keys(theme.tokens)).toEqual(['--color-brand'])
  })
})
