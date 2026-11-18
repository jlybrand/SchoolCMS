'use client'

import { useFormFields } from '@payloadcms/ui'

import { brandTextWarnings, describeBrandWarnings } from '@/lib/theme'

import styles from './BrandContrastNote.module.css'

/**
 * Under the theme's colors (Jason, 2026-11-18: any brand color is accepted, with a warning): says,
 * as the main color is typed, when it is under 4.5:1 as normal-size link text on the site's
 * surfaces, with the numbers, and that large or bold text needs only 3:1. A WARNING — nothing is
 * refused (`brandTextWarnings`, `src/lib/theme.ts`).
 *
 * A polite live region that is always present, so a screen reader hears the note arrive and
 * leave as the color changes, without focus moving.
 */
export const BrandContrastNote = () => {
  const primary = useFormFields(([fields]) => fields.primaryColor?.value)
  const note = describeBrandWarnings(
    brandTextWarnings({ primaryColor: typeof primary === 'string' ? primary : null }),
  )
  return (
    <div aria-live="polite" className={styles.wrap} id="brand-contrast-note" role="status">
      {note ? <p className={styles.note}>{note}</p> : null}
    </div>
  )
}
