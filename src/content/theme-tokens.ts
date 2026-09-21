import { THEME_FIELDS, checkThemeColors, toHexColor } from '@/lib/theme'
import type { ThemeColors, ThemeField } from '@/lib/theme'

import type { Theme } from './types'

/**
 * Payload `theme` row -> the custom properties it overrides (`02` §4.4, `02` §11).
 *
 * PURE, and in its own file for the reason `menus.ts` is: `theme.ts` imports the Payload
 * config to run the query.
 *
 * VALIDATES AGAIN, and drops a failing palette WHOLE. The field validator tells the editor;
 * this is what `07` §3's "cannot ship a combination that fails AA" actually rests on, because
 * it also covers a row written around the validator and a palette that passed until the
 * platform's own neutrals changed underneath it. Whole rather than per-colour, because a
 * palette is judged as a set — half of one is a combination nobody checked.
 */

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const NO_OVERRIDES: Theme = { tokens: {} }

export const toTheme = (doc: unknown): Theme => {
  if (!isRow(doc)) return NO_OVERRIDES

  const colors: ThemeColors = {}
  const tokens: Record<string, string> = {}

  for (const [field, { token }] of Object.entries(THEME_FIELDS)) {
    const raw = doc[field]
    if (raw === null || raw === undefined || raw === '') continue

    const hex = toHexColor(raw)
    // Not a colour: nothing here is safe to put in a style attribute.
    if (hex === null) return NO_OVERRIDES

    colors[field as ThemeField] = hex
    tokens[token] = hex
  }

  if (checkThemeColors(colors).length > 0) return NO_OVERRIDES

  return { tokens }
}
