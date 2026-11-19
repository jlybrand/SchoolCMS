import type { Payload } from 'payload'
import type { CSSProperties } from 'react'

import { getAdminBrand } from './brand-data'
import styles from './Brand.module.css'

/**
 * The band atop the admin's start screens, both planes (Jason, 2026-11-18: white-label the
 * platform, not per school): the district site's logo (its Settings) and the platform's name.
 * On a school manager's start screen it is their school's (`school`; Jason, 2026-11-18 and
 * 2026-11-19): its name, its own logo, and its two colors on the underline — set as the band's
 * two color properties, hex only (`adminBrand`). White, with the name in the district's primary
 * (11.8:1), so a logo made for a white page shows as made. Not a heading — each screen's own
 * `h1` follows it.
 */
export const BrandBand = async ({
  payload,
  school,
}: {
  payload: Payload
  school?: { id: number | string; name: string }
}) => {
  const brand = await getAdminBrand(payload, school)
  const rule = brand.rule
    ? ({
        '--band-rule': brand.rule.primary,
        '--band-stripe': brand.rule.secondary,
      } as CSSProperties)
    : undefined
  return (
    <div className={styles.band} id="brand-band" {...(rule ? { style: rule } : {})}>
      {brand.logo ? (
        // A library image of any size: held to the band's height, its width following.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={brand.logo.alt}
          className={styles.logo}
          src={brand.logo.src}
          {...(brand.logo.width ? { width: brand.logo.width } : {})}
          {...(brand.logo.height ? { height: brand.logo.height } : {})}
        />
      ) : null}
      <span className={styles.name}>{brand.name}</span>
    </div>
  )
}
