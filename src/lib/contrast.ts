/**
 * Token-level contrast validation (`07` §3).
 *
 * The design suite makes a specific promise: per-tenant palettes are validated against AA
 * contrast **at token level, so a school cannot pick a brand colour that fails**. That is
 * only meaningful if one function answers the question everywhere it is asked —
 *
 *   - `tests/unit/tokens.test.ts` runs it over the shipped defaults in `tokens.css`
 *   - `src/lib/theme.ts` runs it over a tenant's overrides, before they can be saved and
 *     again before they are rendered (`03` §5)
 *
 * — because two implementations would eventually disagree, and the one that disagreed
 * generously would be the one that let a failing palette ship.
 *
 * Deliberately dependency-free and deliberately narrow: hex only, no alpha, no `var()`
 * indirection. Every case it cannot evaluate is reported as a failure rather than skipped
 * (see `checkContrastPairs`). A checker that quietly ignores what it does not understand
 * shrinks its own gate over time.
 */

export type Rgb = { readonly r: number; readonly g: number; readonly b: number }

const HEX = /^#([\da-f]{3}|[\da-f]{6})$/i

/**
 * Hex only — `#rgb` or `#rrggbb`.
 *
 * `#rrggbbaa` is rejected rather than composited: the contrast of a translucent colour
 * depends on whatever is painted behind it, which a token does not know. Named colours and
 * `rgb()`/`hsl()` are rejected because the theme UI produces hex, and a parser that guesses
 * at the rest would be a parser nobody can reason about.
 */
export const parseHexColor = (value: string): Rgb | null => {
  const trimmed = value.trim()
  if (!HEX.test(trimmed)) return null

  const digits = trimmed.slice(1)
  const pairs =
    digits.length === 3
      ? [...digits].map((digit) => `${digit}${digit}`)
      : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)]

  const [r, g, b] = pairs.map((pair) => Number.parseInt(pair, 16))
  return { r: r ?? 0, g: g ?? 0, b: b ?? 0 }
}

/** WCAG 2.x relative luminance (sRGB). 0 for black, 1 for white. */
export const relativeLuminance = ({ r, g, b }: Rgb): number => {
  const linear = (channel: number) => {
    const srgb = channel / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/**
 * WCAG 2.x contrast ratio, 1–21. Symmetric in its arguments.
 *
 * Throws on a colour it cannot evaluate. The alternative — returning a number — would mean
 * a typo'd token reporting conformance the platform does not have.
 */
export const contrastRatio = (a: string, b: string): number => {
  const first = parseHexColor(a)
  const second = parseHexColor(b)
  if (!first) throw new Error(`Cannot evaluate contrast: unsupported colour value "${a}"`)
  if (!second) throw new Error(`Cannot evaluate contrast: unsupported colour value "${b}"`)

  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))

  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * AA thresholds.
 *
 * `largeText` is 18pt / 14pt bold or larger (1.4.3); `nonText` covers UI component
 * boundaries, meaningful graphics and focus indicators (1.4.11, 2.4.11).
 */
export const CONTRAST_MINIMUMS = {
  bodyText: 4.5,
  largeText: 3,
  nonText: 3,
} as const

export type ContrastRequirement = keyof typeof CONTRAST_MINIMUMS

/** A pair of token *names* — resolved by the caller, so defaults and tenant overrides share one manifest. */
export type ContrastPair = {
  readonly label: string
  readonly foreground: string
  readonly background: string
  readonly requirement: ContrastRequirement
}

export type ContrastFailure = {
  readonly label: string
  readonly foreground: string
  readonly background: string
  readonly required: number
  readonly reason: 'unresolved-token' | 'unevaluable-colour' | 'insufficient-contrast'
  /** Absent when the pair could not be evaluated at all. */
  readonly ratio?: number
}

export type TokenResolver = (token: string) => string | undefined

/**
 * Checks every pair and returns *all* failures.
 *
 * All of them, not the first: a school submitting a brand palette needs to see everything
 * that has to change, and one-at-a-time correction of a colour scheme is how a validator
 * becomes the thing people work around.
 */
export const checkContrastPairs = (
  pairs: readonly ContrastPair[],
  resolve: TokenResolver,
): ContrastFailure[] => {
  const failures: ContrastFailure[] = []

  for (const { label, foreground, background, requirement } of pairs) {
    const required = CONTRAST_MINIMUMS[requirement]
    const base = { label, foreground, background, required }

    const foregroundValue = resolve(foreground)
    const backgroundValue = resolve(background)

    if (foregroundValue === undefined || backgroundValue === undefined) {
      failures.push({ ...base, reason: 'unresolved-token' })
      continue
    }

    let ratio: number
    try {
      ratio = contrastRatio(foregroundValue, backgroundValue)
    } catch {
      failures.push({ ...base, reason: 'unevaluable-colour' })
      continue
    }

    // Rounded to two decimals before comparison, matching how every contrast tool reports
    // a ratio. Without this a 4.4996 reads as "4.50:1, failed" in the message, which sends
    // whoever sees it looking for a bug in the checker.
    if (Math.round(ratio * 100) / 100 < required) {
      failures.push({ ...base, reason: 'insufficient-contrast', ratio })
    }
  }

  return failures
}

/**
 * The pairs that must hold for the default palette and for every tenant theme.
 *
 * A colour token that appears in no pair is a colour token free to drift below AA, so the
 * token suite asserts this manifest covers all of them. Two tokens are excluded there by
 * name, with reasons:
 *
 *   - `--color-border` is a decorative hairline. 1.4.11 covers the boundaries of
 *     *interactive components* and meaningful graphics, not every rule on the page; forcing
 *     3:1 here would mean heavy grey lines between every section for no accessibility gain.
 *     Interactive boundaries use `--color-border-strong`, which is checked.
 *   - `--color-surface` and `--color-surface-raised` are backgrounds; they are checked as
 *     the background half of the pairs below.
 *
 * Alert severity colours are checked as text/icon colours. When the alert block lands with
 * tinted backgrounds (Phase 5, `03` §2) it adds its own pairs here.
 */
export const REQUIRED_CONTRAST_PAIRS: readonly ContrastPair[] = [
  {
    label: 'body text on surface',
    foreground: '--color-text',
    background: '--color-surface',
    requirement: 'bodyText',
  },
  {
    label: 'body text on raised surface',
    foreground: '--color-text',
    background: '--color-surface-raised',
    requirement: 'bodyText',
  },
  {
    label: 'muted text on surface',
    foreground: '--color-text-muted',
    background: '--color-surface',
    requirement: 'bodyText',
  },
  {
    label: 'muted text on raised surface',
    foreground: '--color-text-muted',
    background: '--color-surface-raised',
    requirement: 'bodyText',
  },
  {
    label: 'link text on surface',
    foreground: '--color-brand',
    background: '--color-surface',
    requirement: 'bodyText',
  },
  {
    label: 'link text on raised surface',
    foreground: '--color-brand',
    background: '--color-surface-raised',
    requirement: 'bodyText',
  },
  {
    label: 'text on a brand fill',
    foreground: '--color-brand-contrast',
    background: '--color-brand',
    requirement: 'bodyText',
  },
  {
    label: 'interactive boundary on surface',
    foreground: '--color-border-strong',
    background: '--color-surface',
    requirement: 'nonText',
  },
  {
    label: 'interactive boundary on raised surface',
    foreground: '--color-border-strong',
    background: '--color-surface-raised',
    requirement: 'nonText',
  },
  {
    label: 'focus ring on surface',
    foreground: '--focus-ring-color',
    background: '--color-surface',
    requirement: 'nonText',
  },
  {
    label: 'focus ring on raised surface',
    foreground: '--focus-ring-color',
    background: '--color-surface-raised',
    requirement: 'nonText',
  },
  {
    /**
     * `Link`'s button variant swaps its fill to `--color-text` on hover and keeps its label
     * colour. Unlisted, that was a pair the stylesheet used and nothing checked — harmless
     * while both values were the platform's, and exactly the gap a tenant theme would find.
     */
    label: 'text on a hovered brand fill',
    foreground: '--color-brand-contrast',
    background: '--color-text',
    requirement: 'bodyText',
  },
  {
    /**
     * The pair most often missed. A single dark focus ring is invisible on a brand-coloured
     * control — which is exactly where focus lands first on every page, the skip link.
     * `--focus-ring-color-inverse` is the ring used on brand fills (2.4.11).
     */
    label: 'focus ring on a brand fill',
    foreground: '--focus-ring-color-inverse',
    background: '--color-brand',
    requirement: 'nonText',
  },
  {
    label: 'informational text on surface',
    foreground: '--color-info',
    background: '--color-surface',
    requirement: 'bodyText',
  },
  {
    label: 'warning text on surface',
    foreground: '--color-warning',
    background: '--color-surface',
    requirement: 'bodyText',
  },
  {
    label: 'emergency text on surface',
    foreground: '--color-emergency',
    background: '--color-surface',
    requirement: 'bodyText',
  },
] as const
