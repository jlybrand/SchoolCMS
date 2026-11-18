import { THEME_FIELDS, brandFillTokens, toHexColor } from '@/lib/theme'

import type { Theme } from './types'

/**
 * Payload `theme` row -> the custom properties it overrides (`02` §4.4, `02` §11).
 *
 * PURE, and in its own file for the reason `menus.ts` is: `theme.ts` imports the Payload
 * config to run the query.
 *
 * ANY COLOR IS SERVED (Jason, 2026-11-18): only a value that is not a color is dropped — the
 * whole row then, since nothing in it can be trusted into a `style` attribute. With a brand
 * color, everything that sits ON a brand fill is derived from it (`brandFillTokens`: the fill's
 * text, its hover, the focus ring on it), so buttons and the skip link read whatever the color.
 * The brand color as link TEXT is the school's choice; the theme form warns under 4.5:1.
 */

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const NO_OVERRIDES: Theme = { tokens: {} }

export const toTheme = (doc: unknown): Theme => {
  if (!isRow(doc)) return NO_OVERRIDES

  const tokens: Record<string, string> = {}

  for (const [field, { token }] of Object.entries(THEME_FIELDS)) {
    const raw = doc[field]
    if (raw === null || raw === undefined || raw === '') continue

    const hex = toHexColor(raw)
    // Not a color: nothing here is safe to put in a style attribute.
    if (hex === null) return NO_OVERRIDES

    tokens[token] = hex
  }

  const brand = tokens['--color-brand']
  return { tokens: brand ? { ...tokens, ...brandFillTokens(brand) } : tokens }
}
