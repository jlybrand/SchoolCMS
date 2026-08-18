/**
 * DD2 DOMAIN TYPES — hand-written, never generated from Payload (`02` §11, ADR-5).
 *
 * This is the vocabulary the entire rendering layer speaks. Components, templates, and the
 * translation pipeline consume these and nothing else. The mapping from Payload's generated
 * types happens exactly once, inside `src/content/*`.
 *
 * Swapping the CMS means rewriting ~8 files in this directory, not ~200 components. That
 * property only survives if these types stay hand-written — the moment they are generated
 * from Payload, the boundary is decorative.
 *
 * PHASE 0 SCOPE: only the types the tenancy spine needs. Each content module adds its own
 * types in its own phase (`05`). Do not add speculative shapes here.
 */

/** Locale tiers per `08` §2. `en` is the only authored language. */
export type Locale = string

export type TenantType = 'district' | 'school'

export type Tenant = {
  id: string
  slug: string
  name: string
  /** Drives routing. Resolved from the request Host at the edge (`02` §4.1). */
  hostname: string
  type: TenantType
}

/** Public vs. staff-gated content (`01` §4.3). Staff requires a valid Entra session. */
export type Visibility = 'public' | 'staff'

/**
 * Every content-access function takes this. Tenant is resolved from the hostname before
 * anything downstream runs; it is never a user-supplied parameter.
 */
export type ContentContext = {
  tenant: Tenant
  locale: Locale
}

/**
 * PAGES (`03` §2).
 *
 * `pageType` decides the editing shape: the fixed types carry typed fields a school manager
 * fills in, `composed` carries the district-only block array (§3). One enum rather than two
 * collections, so enabling school composition later (`01` §4.1) is an access-predicate
 * change and nothing else.
 */
export type PageType =
  'standard' | 'about' | 'contact' | 'staff' | 'calendar' | 'documents' | 'composed'

/** The fixed types a school manager may author. `composed` is district-only (`03` §2). */
export const FIXED_PAGE_TYPES: readonly PageType[] = [
  'standard',
  'about',
  'contact',
  'staff',
  'calendar',
  'documents',
] as const

/**
 * A page as the rendering layer sees it.
 *
 * SCOPE: this is the page SPINE — identity, hierarchy, type, visibility, status. Body
 * content is deliberately absent. Fixed-type bodies arrive with the constrained rich-text
 * slice and `composed` bodies with the block library, each defining its own hand-written
 * node types. Declaring a body shape here before either exists would be the speculative
 * modelling `03` §4 warns against, and the wrong shape is more expensive than none.
 */
export type Page = {
  id: string
  /** Owning tenant. A page is never readable outside it unless syndicated (`03` §6.4). */
  tenantId: string
  title: string
  slug: string
  /** Full path from the site root, e.g. `/about/staff`. Assembled from the parent chain. */
  path: string
  pageType: PageType
  visibility: Visibility
  /** Parent page id, or null at the top level. Drives hierarchy and navigation. */
  parentId: string | null
  /** Gates locale publication for high-stakes content (`08` §7.1). */
  requiresTranslationReview: boolean
}
