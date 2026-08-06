import type { CollectionConfig } from 'payload'

/**
 * PHASE 0 STUB. Payload requires exactly one auth-enabled collection to boot; this is it,
 * and nothing more. Do not build on it speculatively.
 *
 * Phase 1 (`05`) replaces this with the real shape from `03` §2:
 *   - `entraObjectId` (unique — the durable identity), `roles`, `tenants`, `defaultTenant`
 *   - the Entra ID OIDC custom auth strategy; no password storage (`02` §7)
 *   - the single audited break-glass local admin, explicitly flagged
 *   - `autoApprove` scopes — EMPTY BY DEFAULT, granted per named user by a district-admin,
 *     never defaulted by role, tenant, or collection (`04` §4.3)
 *   - deny-by-default access functions returning QUERY CONSTRAINTS, never booleans
 *     (`03` §6.2), proven by the adversarial isolation suite (`03` §6.4)
 *
 * Local auth is enabled here only so the app boots before Entra exists. It is removed in
 * Phase 1 except for the break-glass account.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'email',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
    },
  ],
}
