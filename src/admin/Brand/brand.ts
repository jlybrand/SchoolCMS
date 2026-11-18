import { toImageAsset } from '@/content/image-asset'
import type { ImageAsset } from '@/content/types'

/**
 * The admin's branding (Jason, 2026-11-18: white-label the platform, not per school) — PURE.
 * The platform's name, and the district site's logo from its Settings (`logo`, a library image,
 * so its alt text is the library's — rule 7) for the band atop the start screens (`BrandBand`).
 * The platform's own logo and mark are fixed files (`public/brand/`, `PlatformLogo`).
 */

/** The platform's name (Jason, 2026-11-18: "DDTwo Websites"). Tabs, sign-in, emails, the band. */
export const PLATFORM_NAME = 'DDTwo Websites'

export type AdminBrand = { name: string; logo: ImageAsset | null }

/**
 * From the district site's Settings row (`logo` populated), or null when it has none. A school
 * manager's start screen names their SCHOOL instead of the platform (Jason, 2026-11-18); the logo
 * stays the district's.
 */
export const adminBrand = (settings: { logo?: unknown } | null, school?: string): AdminBrand => ({
  name: school?.trim() || PLATFORM_NAME,
  logo: settings ? toImageAsset(settings.logo) : null,
})
