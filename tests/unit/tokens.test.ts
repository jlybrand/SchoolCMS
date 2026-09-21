import { describe, expect, it } from 'vitest'

import { CONTRAST_MINIMUMS, REQUIRED_CONTRAST_PAIRS, checkContrastPairs } from '@/lib/contrast'
import { RTL_LOCALES } from '@/lib/locales'

import {
  localesWithTypographyOverrides,
  readLocaleTokenBlocks,
  readRootTokens,
} from '../helpers/tokens'

/**
 * The token-level conformance suite (`07` §3, `08` §7).
 *
 * Two claims in the design suite are only true if something checks them on every build:
 *
 *   1. "Contrast is baked into theme tokens ... so a school cannot pick a brand colour that
 *      fails" — the same `checkContrastPairs` call runs here over the shipped defaults and,
 *      in `src/lib/theme.ts`, over each tenant's `theme` overrides. If the default palette were
 *      allowed to fail, the per-tenant validator would be enforcing a bar the platform
 *      itself does not meet.
 *   2. "Per-locale typography tokens" — a locale block that sets a CJK font stack but
 *      forgets the taller line-height renders cramped in a way no automated a11y check
 *      catches and no English-reading reviewer notices.
 */

/**
 * Locales whose script needs its own type treatment (`08` §7). CJK glyphs need more
 * line-height than Latin and no webfont fits the LCP budget, so they ride a system stack;
 * Arabic needs both a Naskh stack and the extra leading.
 */
const CJK_LOCALES = ['zh-Hans', 'ko'] as const

describe('design tokens: contrast (`07` §3)', () => {
  const tokens = readRootTokens()
  const resolve = (token: string) => tokens[token]

  it('parses the token file', () => {
    // Guards the guard: a parser that silently returned {} would make every assertion
    // below vacuous.
    expect(Object.keys(tokens).length).toBeGreaterThan(20)
    expect(tokens['--color-surface']).toBe('#ffffff')
  })

  it('declares a pair for every colour token that carries meaning', () => {
    /**
     * A colour token nobody checks is a colour token free to drift below AA, so the
     * manifest has to cover all of them. Exclusions are by name, with the reasoning in
     * `REQUIRED_CONTRAST_PAIRS`: the two surfaces are only ever the background half of a
     * pair, and `--color-border` is a decorative hairline outside 1.4.11.
     */
    const UNPAIRED_BY_DESIGN = [
      '--color-surface',
      '--color-surface-raised',
      '--color-border',
      // Decorative rules only, like `--color-border` — see its declaration in tokens.css.
      '--color-accent',
    ]

    const colourTokens = Object.keys(tokens).filter(
      (name) => name.startsWith('--color-') || name === '--focus-ring-color',
    )
    const paired = new Set(
      REQUIRED_CONTRAST_PAIRS.flatMap((pair) => [pair.foreground, pair.background]),
    )

    expect(
      colourTokens.filter((name) => !paired.has(name) && !UNPAIRED_BY_DESIGN.includes(name)),
    ).toEqual([])
  })

  it.each(REQUIRED_CONTRAST_PAIRS)(
    '$label meets the $requirement minimum',
    ({ label, foreground, background, requirement }) => {
      const [failure] = checkContrastPairs(
        [{ label, foreground, background, requirement }],
        resolve,
      )

      expect(
        failure,
        failure
          ? `${label}: ${failure.reason}` +
              (failure.ratio === undefined
                ? ''
                : ` — ${failure.ratio.toFixed(2)}:1, needs ${CONTRAST_MINIMUMS[requirement]}:1`)
          : '',
      ).toBeUndefined()
    },
  )

  it('reports every default palette failure at once', () => {
    // The per-pair cases above name the offender; this one is what the theme
    // validator will call, so it is exercised in the same shape production uses it.
    expect(checkContrastPairs(REQUIRED_CONTRAST_PAIRS, resolve)).toEqual([])
  })
})

describe('design tokens: per-locale typography (`08` §7)', () => {
  const overriddenLocales = localesWithTypographyOverrides()

  it.each([...CJK_LOCALES, ...RTL_LOCALES])('%s has a typography override block', (locale) => {
    expect(overriddenLocales).toContain(locale)
  })

  it.each(readLocaleTokenBlocks())(
    '`$selector` sets both the font stack and the line height',
    ({ tokens }) => {
      // Half an override is the failure mode worth guarding: the font changes, the leading
      // does not, and the result is cramped CJK that reads as "the site looks wrong in
      // Korean" months later.
      expect(Object.keys(tokens).sort()).toEqual(['--font-family-locale', '--line-height-base'])
    },
  )

  it('defines both locale typography tokens at :root so an unlisted locale still renders', () => {
    const tokens = readRootTokens()
    expect(tokens['--font-family-locale']).toBeDefined()
    expect(tokens['--line-height-base']).toBeDefined()
  })
})
