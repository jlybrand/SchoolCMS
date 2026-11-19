import { toImageAsset } from '@/content/image-asset'
import { toHexColor } from '@/lib/theme'
import type { ImageAsset } from '@/content/types'

/**
 * The admin's branding (Jason, 2026-11-18: white-label the platform, not per school) — PURE.
 * The platform's name, and the district site's logo from its Settings (`logo`, a library image,
 * so its alt text is the library's — rule 7) for the band atop the start screens (`BrandBand`).
 * The platform's own logo and mark are fixed files (`public/brand/`, `PlatformLogo`).
 */

/** The platform's name (Jason, 2026-11-18: "DDTwo Websites"). Tabs, sign-in, emails, the band. */
export const PLATFORM_NAME = 'DDTwo Websites'

/** The band's underline: a rule in `primary`, a stripe in `secondary`. */
export type BandRule = { primary: string; secondary: string }

/**
 * `rule` is null on the district's band, which keeps the platform's colors (`admin-brand.css`).
 */
export type AdminBrand = { name: string; logo: ImageAsset | null; rule: BandRule | null }

/** A school manager's school: its name, its Settings row (`logo` populated) and its Colors row. */
export type SchoolBrandInput = {
  name: string
  settings?: { logo?: unknown } | null | undefined
  theme?: { primaryColor?: unknown; secondaryColor?: unknown } | null | undefined
}

/**
 * A color the school left empty is what its own site shows (`Theme.ts` help text): the main color
 * falls back to the district's navy — the admin's primary — and the second to the public site's
 * plain grey line (`--color-accent`, `tokens.css`). Through `toHexColor`, so a stored value that
 * is not a color never reaches the page's custom properties.
 */
const DISTRICT_PRIMARY = '#2b3170'
const PLAIN_LINE = '#d3d7de'

/**
 * From the district site's Settings row (`logo` populated), or null when it has none. A school
 * manager's start screen is their SCHOOL's (Jason, 2026-11-18; 2026-11-19): its name in place of
 * the platform's, its own logo (the district's when it has none), and its two colors on the
 * underline. The underline is decorative — no text is read against it — so any color goes.
 */
export const adminBrand = (
  district: { logo?: unknown } | null,
  school?: SchoolBrandInput,
): AdminBrand => {
  const districtLogo = district ? toImageAsset(district.logo) : null
  if (!school) return { name: PLATFORM_NAME, logo: districtLogo, rule: null }
  return {
    name: school.name.trim() || PLATFORM_NAME,
    logo: (school.settings ? toImageAsset(school.settings.logo) : null) ?? districtLogo,
    rule: {
      primary: toHexColor(school.theme?.primaryColor) ?? DISTRICT_PRIMARY,
      secondary: toHexColor(school.theme?.secondaryColor) ?? PLAIN_LINE,
    },
  }
}
