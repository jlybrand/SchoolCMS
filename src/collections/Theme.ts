import type { CollectionConfig, TextField } from 'payload'

import { districtOnly } from '@/access/tenant-scoped'
import { THEME_FIELDS, checkThemeColors, describeThemeFailures, toHexColor } from '@/lib/theme'
import type { ThemeField } from '@/lib/theme'

/**
 * `theme` — a tenant's design-token overrides (`03` §5, `02` §4.4).
 *
 * One row per tenant and district-only for every operation, for the reasons
 * `src/collections/Navigation.ts` gives: registered `isGlobal` with the multi-tenant plugin,
 * which makes `tenant` unique, and `03` §6.1 puts theme out of a school-manager's reach.
 *
 * A SCHOOL'S TWO COLORS. `02` §4.4 lists logo, palette, type scale, hero style and favicon. Logo and
 * favicon are uploads and wait for `media` (Phase 6) — an interim image URL would bypass
 * alt-required-at-upload (CLAUDE.md rule 7). Hero style waits for the hero block. What a
 * theme can change is named in `THEME_FIELDS` (`src/lib/theme.ts`). Any color is accepted for
 * either (Jason, 2026-11-18): what sits on a brand fill is derived so it reads, and the main
 * color as link text is the school's choice, warned about under 4.5:1.
 *
 * Per CLAUDE.md's TDD exception table the declaration is not test-first. The behaviour is
 * `checkThemeColors`, and it is.
 */
/**
 * Each field is validated ON ITS OWN, so the error lands under the color that caused it — and
 * the only error is "that is not a color" (Jason, 2026-11-18: any brand color is accepted).
 * Contrast is a WARNING, shown live under the fields (`BrandContrastNote`), never a refusal.
 */
const colorField = (
  name: ThemeField,
  label: string,
  description: string,
  placeholder: string,
): TextField => ({
  name,
  type: 'text',
  label,
  admin: { description, placeholder },
  validate: (value: unknown) => {
    if (value === null || value === undefined || value === '') return true
    const failures = checkThemeColors({ [name]: String(value) })
    return failures.length === 0 ? true : describeThemeFailures(failures)
  },
})

export const Theme: CollectionConfig = {
  slug: 'theme',
  labels: { singular: 'Colors', plural: 'Colors' },
  admin: { group: 'Site' },

  access: {
    read: districtOnly,
    create: districtOnly,
    update: districtOnly,
    delete: districtOnly,
  },

  hooks: {
    beforeValidate: [
      /**
       * One spelling per color: `#ABC` is stored as `#aabbcc`. Runs before validation, so a
       * value that is not a color is left exactly as typed for the validator to refuse.
       */
      ({ data }) => {
        if (!data) return data
        const next = { ...data }
        for (const field of Object.keys(THEME_FIELDS)) {
          const hex = toHexColor(next[field])
          if (hex !== null) next[field] = hex
        }
        return next
      },
    ],
  },

  fields: [
    colorField(
      'primaryColor',
      'Main color',
      "Used for buttons and links. Any color works: the text on a button is chosen to suit it. As link text, a light color is hard to read — you'll see a note below if so. Leave empty for the district's blue.",
      '#14532d',
    ),
    colorField(
      'secondaryColor',
      'Second color',
      'Used for the colored lines under the header and above the footer. Any color works here. Leave empty for a plain grey line.',
      '#ffcc00',
    ),
    /**
     * The contrast WARNING (Jason, 2026-11-18: accept any color, warn). Live, as the main color
     * is typed — a UI field: it stores nothing.
     */
    {
      name: 'brandContrastNote',
      type: 'ui',
      admin: { components: { Field: '/admin/Theme/BrandContrastNote#BrandContrastNote' } },
    },
  ],
}
