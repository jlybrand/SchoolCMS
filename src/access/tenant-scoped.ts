import type { Access, FieldAccess } from 'payload'

import { isDistrictAdmin, tenantIdOf, tenantIdsFor } from './predicates'
import type { AuthUser } from './types'

/**
 * Access functions for tenant-owned collections (`03` §6.2).
 *
 * THE RULE THAT MATTERS: `read` returns a QUERY CONSTRAINT, never a bare `true`, for any
 * scoped user. Returning a boolean hands back the entire collection and relies on the UI to
 * filter — which is how one school's drafts end up in another school's list view.
 *
 * Payload owns the database connection and does not set per-request session variables, so
 * Postgres row-level security is unavailable (`02` §4.2). These functions, plus the
 * adversarial suite that exercises them over REST, GraphQL, and the Local API, ARE the
 * isolation guarantee — not a secondary check on top of one.
 */

const userOf = (req: { user?: unknown }): AuthUser | null => (req?.user as AuthUser) ?? null

/**
 * Read access for a tenant-owned collection.
 *
 * district-admin -> true (cross-tenant by design, `04` §3.2)
 * scoped user    -> { tenant: { in: [...] } }
 * no tenants     -> false (not an empty `in`, which some query builders drop entirely)
 * anonymous      -> false
 *
 * NOTE: public read of published, public-visibility content is a SEPARATE function added
 * with the first public collection in Phase 3. It is not folded in here, because a single
 * function that sometimes means "public website" and sometimes means "authenticated scope"
 * is one edit away from serving drafts to the internet (`03` §6.4 invariant 4).
 */
export const tenantReadAccess: Access = ({ req }) => {
  const user = userOf(req)
  if (!user) return false
  if (isDistrictAdmin(user)) return true

  const tenantIds = tenantIdsFor(user)
  if (tenantIds.length === 0) return false

  return { tenant: { in: tenantIds } }
}

/**
 * CREATE access for a tenant-owned collection.
 *
 * A create has no existing document, so the only thing to judge is the incoming
 * `data.tenant`. Absent tenant means deny — never fail open.
 */
export const tenantCreateAccess: Access = ({ req, data }) => {
  const user = userOf(req)
  if (!user) return false
  if (isDistrictAdmin(user)) return true

  const allowed = tenantIdsFor(user)
  if (allowed.length === 0) return false

  const incoming = tenantIdOf((data as { tenant?: unknown } | undefined)?.tenant as never)
  if (incoming === null) return false

  return allowed.includes(incoming)
}

/**
 * UPDATE / DELETE access for a tenant-owned collection.
 *
 * Returns a QUERY CONSTRAINT, not a boolean — for the same reason `read` does, and it
 * matters more here. Payload's access args carry `id` and `data`, NOT the existing
 * document, so a boolean written against `data` alone could be satisfied by a partial
 * update that simply omits the tenant field. A constraint makes the database the arbiter:
 * a scoped user can only reach rows already inside their tenants, whatever the payload
 * claims.
 *
 * Reassignment — moving a document from tenant A to tenant B — is a separate concern and is
 * blocked at FIELD level on `tenant` (district-admin only), because it is a change to the
 * field rather than a question of which rows are reachable.
 */
export const tenantWriteAccess: Access = ({ req }) => {
  const user = userOf(req)
  if (!user) return false
  if (isDistrictAdmin(user)) return true

  const tenantIds = tenantIdsFor(user)
  if (tenantIds.length === 0) return false

  return { tenant: { in: tenantIds } }
}

/** Reserved to district-admin (`03` §6.1). */
export const districtOnly: Access = ({ req }) => isDistrictAdmin(userOf(req))

/**
 * Field-level equivalent of `districtOnly`.
 *
 * Field access is a separate Payload type that must return a boolean — a query constraint
 * is meaningless when gating a single field. Kept as its own export rather than casting
 * `districtOnly`, because the two signatures mean genuinely different things and conflating
 * them is how a `Where` object ends up being read as truthy.
 */
export const districtOnlyField: FieldAccess = ({ req }) => isDistrictAdmin(userOf(req))

/** Field-level deny — for values written only by the system (`03` §2). */
export const denyAllField: FieldAccess = () => false

/**
 * Denies everyone, including district-admin. For capabilities that must not exist by any
 * route rather than merely being restricted.
 */
export const denyAll: Access = () => false

/**
 * Read access for the users collection.
 *
 * district-admin -> true
 * anyone else    -> { id: { equals: <self> } }
 *
 * A school-manager cannot enumerate other staff, and the public surface never returns user
 * records at all (`03` §6.4 invariant 4).
 */
export const selfOrDistrictAdmin: Access = ({ req }) => {
  const user = userOf(req)
  if (!user) return false
  if (isDistrictAdmin(user)) return true
  return { id: { equals: user.id } }
}
