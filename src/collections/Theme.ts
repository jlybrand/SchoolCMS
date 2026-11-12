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
 * theme can change is named in `THEME_FIELDS` (`src/lib/theme.ts`), and why the two colors are
 * held to different standards is recorded there.
 *
 * Per CLAUDE.md's TDD exception table the declaration is not test-first. The behaviour is
 * `checkThemeColors`, and it is.
 */
/**
 * Each field is validated ON ITS OWN, so the error lands under the color that caused it.
 * `07` §3: a school cannot pick a color that fails — every broken pair is reported at once.
 * The same check runs again at render, over both colors together, in
 * `src/content/theme-tokens.ts`; this one is for the person typing.
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
      "Used for links and buttons, so it has to be dark enough to read on a white page. Leave empty for the district's blue. If the school's main color is a light one — a gold, a sky blue — put the darker of its two colors here and the light one below.",
      '#14532d',
    ),
    colorField(
      'secondaryColor',
      'Second color',
      'Used for the colored lines under the header and above the footer. Any color works here. Leave empty for a plain grey line.',
      '#ffcc00',
    ),
  ],
}
