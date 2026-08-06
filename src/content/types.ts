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
