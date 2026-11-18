import { REQUIRED_CONTRAST_PAIRS, checkContrastPairs, contrastRatio } from './contrast'
import type { ContrastFailure } from './contrast'

/**
 * Per-tenant theme validation (`02` §4.4, `07` §3).
 *
 * `07` §3: "per-tenant palettes are validated against AA contrast at token level, so a
 * school cannot pick a brand color that fails." A tenant's overrides are laid over the
 * platform's defaults and the result goes through the SAME `checkContrastPairs`, against the
 * SAME `REQUIRED_CONTRAST_PAIRS`, as the shipped palette does in `tests/unit/tokens.test.ts`.
 * One checker, one manifest; a second of either would eventually disagree.
 *
 * Pure, so it runs in both places it matters: as the field validator, which tells the
 * editor, and in the content mapper, which does not trust that the validator ran.
 */

/**
 * The platform's value for every token a contrast pair names.
 *
 * A MIRROR OF `tokens.css`, which production never parses. It has to exist: a tenant
 * overrides one color, and every pair that color appears in is judged against the
 * platform's other colors. `tests/unit/theme.test.ts` asserts this object equals the
 * stylesheet, token for token — change one without the other and the suite fails, which is
 * the only thing that makes a mirror honest.
 */
export const DEFAULT_COLOR_TOKENS: Readonly<Record<string, string>> = {
  '--color-surface': '#ffffff',
  '--color-surface-raised': '#f6f7f9',
  '--color-border-strong': '#828893',
  '--color-text': '#14171c',
  '--color-text-muted': '#4d5563',
  '--color-highlight': '#fff2a8',
  '--color-brand': '#0f4c81',
  '--color-brand-contrast': '#ffffff',
  '--color-brand-hover': '#14171c',
  '--color-info': '#0f4c81',
  '--color-warning': '#7a4a00',
  '--color-emergency': '#8a1420',
  '--focus-ring-color': '#0b57d0',
  '--focus-ring-color-inverse': '#ffffff',
  '--focus-ring-color-on-brand': '#ffffff',
}

/**
 * What a tenant may change, and the token each field sets: a school's two colors.
 *
 * ANY COLOR IS ACCEPTED for either (Jason, 2026-11-18); what each is used for decides the rest.
 *
 *   - `primaryColor` is `--color-brand`: buttons, the skip link, links. What sits ON it — the
 *     fill's text, its hover, the focus ring on it — is derived from it (`brandFillTokens`), so
 *     fills always pass. As link TEXT it is the school's choice, warned about under 4.5:1
 *     (`brandTextWarnings`), never refused: AA there depends on size and weight.
 *   - `secondaryColor` is `--color-accent`: decorative rules. Nothing is read against it.
 *
 * `--color-brand-contrast` is not offered as a field: it has no free choice in it, it is
 * whichever of white and black reads on the brand color (`textOn`).
 *
 * The neutrals, the focus rings (but the one ON a brand fill, derived) and the alert
 * severities stay the platform's: they carry
 * meaning that must read the same on all 28 sites. A closed map, so the custom properties
 * that reach the markup are named HERE and never by a row. Logo and favicon join with
 * `media` (Phase 6) and hero style with the hero block.
 */
export const THEME_FIELDS = {
  primaryColor: { token: '--color-brand' },
  secondaryColor: { token: '--color-accent' },
} as const satisfies Record<string, { token: string }>

export type ThemeField = keyof typeof THEME_FIELDS

export type ThemeColors = Partial<Record<ThemeField, string | null | undefined>>

const HEX = /^#([\da-f]{3}|[\da-f]{6})$/i

/**
 * `#rrggbb`, lowercase, or null.
 *
 * The value ends up in a `style` attribute, so "is it a color" is also "is it safe", and
 * the answer is an exact match on hex digits — nothing to escape because nothing else gets
 * through. `#rgb` is expanded so one color has one spelling everywhere.
 */
export const toHexColor = (value: unknown): string | null => {
  if (typeof value !== 'string') return null

  const trimmed = value.trim().toLowerCase()
  if (!HEX.test(trimmed)) return null

  if (trimmed.length === 7) return trimmed
  return `#${[...trimmed.slice(1)].map((digit) => `${digit}${digit}`).join('')}`
}

const isUnset = (value: unknown): boolean => value === null || value === undefined || value === ''

/**
 * What is wrong with the theme: only a value that is NOT A COLOR (Jason, 2026-11-18: a school
 * may pick any brand color). Both fields, every malformed value — a hex color is also the only
 * thing that is safe in the `style` attribute it ends up in. Contrast is not judged here: what
 * sits on a brand fill is derived so it always reads (`brandFillTokens`), and the brand color as
 * TEXT is the school's choice, warned about but never refused (`brandTextWarnings`).
 */
export const checkThemeColors = (colors: ThemeColors): ContrastFailure[] =>
  Object.entries(THEME_FIELDS).flatMap(([field, { token }]) => {
    const value = colors[field as ThemeField]
    if (isUnset(value) || toHexColor(value) !== null) return []
    return [
      {
        label: field,
        foreground: token,
        background: token,
        required: 0,
        reason: 'unevaluable-color' as const,
      },
    ]
  })

/** The refusal, in plain words: only ever "that is not a color". */
export const describeThemeFailures = (failures: readonly ContrastFailure[]): string =>
  failures.length === 0
    ? ''
    : 'Enter the color as a # followed by six letters or numbers, like #0f4c81.'

const WHITE = '#ffffff'
/** PURE black, not the near-black text color: with #14171c some mid-tone fills top out near 4.2:1. */
const BLACK = '#000000'

/** The text that reads on a fill: white or black, whichever contrasts more — ≥ 4.58:1 on any color. */
export const textOn = (fill: string): string =>
  contrastRatio(WHITE, fill) >= contrastRatio(BLACK, fill) ? WHITE : BLACK

const mix = (hex: string, toward: string, amount: number): string => {
  const channels = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16))
  const [a, b] = [channels(hex), channels(toward)]
  return `#${a
    .map((value, i) => Math.round(value + (b[i]! - value) * amount))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * Everything that sits ON the brand color, derived from it (Jason, 2026-11-18): the text on a
 * brand fill, the fill on hover, and the focus ring on it. With white text the hover goes dark,
 * as the platform's has; with black text it goes LIGHTER, which only raises the contrast. So the
 * fill pairs in `REQUIRED_CONTRAST_PAIRS` pass for any brand color — `theme.test.ts` sweeps it.
 */
export const brandFillTokens = (brand: string): Record<string, string> => {
  const text = textOn(brand)
  return {
    '--color-brand-contrast': text,
    '--color-brand-hover':
      text === WHITE ? DEFAULT_COLOR_TOKENS['--color-text']! : mix(brand, WHITE, 0.35),
    '--focus-ring-color-on-brand': text,
  }
}

/** The pairs where the brand color IS the text — the school's choice, warned about, not refused. */
export const BRAND_TEXT_PAIRS: readonly string[] = [
  'link text on surface',
  'link text on raised surface',
]

export type BrandTextWarning = { label: string; ratio: number; required: number }

/** Where the main color, as link text, is under its pair's requirement (4.5:1 for normal text). */
export const brandTextWarnings = (colors: ThemeColors): BrandTextWarning[] => {
  const brand = toHexColor(colors.primaryColor)
  if (brand === null) return []
  const tokens: Record<string, string> = { ...DEFAULT_COLOR_TOKENS, '--color-brand': brand }
  return checkContrastPairs(
    REQUIRED_CONTRAST_PAIRS.filter((pair) => BRAND_TEXT_PAIRS.includes(pair.label)),
    (token) => tokens[token],
  ).map(({ label, ratio, required }) => ({ label, ratio: ratio ?? 0, required }))
}

const SURFACE_NAMES: Readonly<Record<string, string>> = {
  'link text on surface': 'the white page',
  'link text on raised surface': 'the light-grey panels',
}

/** The warning, in plain words, with the numbers — and what large or bold text needs instead. */
export const describeBrandWarnings = (warnings: readonly BrandTextWarning[]): string => {
  if (warnings.length === 0) return ''
  const where = warnings
    .map(({ label, ratio }) => `${SURFACE_NAMES[label] ?? label} (${ratio.toFixed(1)}:1)`)
    .join(' and ')
  return (
    `As link text, this color is under 4.5:1 on ${where}, so it is hard to read as normal-size ` +
    'text there. Large or bold text needs only 3:1. Buttons are not affected: their text color is ' +
    'chosen to suit the color.'
  )
}
