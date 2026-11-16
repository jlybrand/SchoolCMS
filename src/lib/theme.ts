import { REQUIRED_CONTRAST_PAIRS, checkContrastPairs } from './contrast'
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
  '--color-info': '#0f4c81',
  '--color-warning': '#7a4a00',
  '--color-emergency': '#8a1420',
  '--focus-ring-color': '#0b57d0',
  '--focus-ring-color-inverse': '#ffffff',
}

/**
 * What a tenant may change, and the token each field sets: a school's two colors.
 *
 * THE TWO ARE NOT EQUALS, and the difference is what each is used for.
 *
 *   - `primaryColor` is `--color-brand`: link text, buttons, the skip link. It is READ, so it
 *     has to pass every pair it appears in, and in practice that means dark.
 *   - `secondaryColor` is `--color-accent`: decorative rules. Nothing is read against it, so
 *     any color is accepted — which is where a school's gold or sky blue goes.
 *
 * A school whose main color is the light one (gold and black) enters them the other way
 * round; `describeThemeFailures` says so. `--color-brand-contrast` is not offered, because
 * it has no free choice in it — a color dark enough to be link text on white (4.5:1) is by
 * the same arithmetic dark enough to carry white text.
 *
 * The neutrals, the focus rings and the alert severities stay the platform's: they carry
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
 * Everything wrong with the theme — all of it, not the first thing.
 *
 * Two kinds of failure. A value that is not a hex color fails OUTRIGHT, for every field:
 * that cannot be left to the pairs, because no pair names `--color-accent` and an unparseable
 * secondary color would otherwise sail through as "nothing to check". Then every pair that
 * involves an overridden token is checked against the platform's other colors; the rest are
 * the platform's own and the token suite owns them.
 */
export const checkThemeColors = (colors: ThemeColors): ContrastFailure[] => {
  const overrides = new Map<string, string>()
  const malformed: ContrastFailure[] = []

  for (const [field, { token }] of Object.entries(THEME_FIELDS)) {
    const value = colors[field as ThemeField]
    if (isUnset(value)) continue

    const hex = toHexColor(value)
    if (hex === null) {
      malformed.push({
        label: field,
        foreground: token,
        background: token,
        required: 0,
        reason: 'unevaluable-color',
      })
      continue
    }

    overrides.set(token, hex)
  }

  const affected = REQUIRED_CONTRAST_PAIRS.filter(
    (pair) => overrides.has(pair.foreground) || overrides.has(pair.background),
  )

  return [
    ...malformed,
    ...checkContrastPairs(affected, (token) => overrides.get(token) ?? DEFAULT_COLOR_TOKENS[token]),
  ]
}

/**
 * The failures, in words a district admin can act on (`04` §2.1).
 *
 * Says which way to move first — every real failure here is "too light", since the main
 * color is link text on a white page — and what to do when the school's main color IS its
 * light one, then lists each broken pair with its numbers, so the
 * person choosing between two shades can see how far off each one is. Never names a token.
 */
export const describeThemeFailures = (failures: readonly ContrastFailure[]): string => {
  if (failures.length === 0) return ''

  if (failures.some((failure) => failure.reason !== 'insufficient-contrast')) {
    return 'Enter the color as a # followed by six letters or numbers, like #0f4c81.'
  }

  const details = failures
    .map(
      ({ label, ratio, required }) =>
        `${label} (${(ratio ?? 0).toFixed(1)}:1, needs ${required}:1)`,
    )
    .join('; ')

  return (
    'This color is too light to read. The main color is used for links and buttons, so it ' +
    "needs strong contrast with the page — try a darker shade. If the school's main color " +
    'is its light one, put the darker of the two here and the light one in as the second ' +
    `color. What fails: ${details}.`
  )
}
