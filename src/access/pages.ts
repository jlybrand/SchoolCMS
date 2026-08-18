import type { Access, Where } from 'payload'

import { isDistrictAdmin, isSystemSync, tenantIdOf, tenantIdsFor } from './predicates'
import type { AuthUser } from './types'

/**
 * Access functions for `pages` (`03` §2, §6.2).
 *
 * WHY THIS COLLECTION DECLARES ITS OWN rather than importing `src/access/tenant-scoped.ts`:
 * three rules apply here that the generic tenant-scoped functions do not express.
 *
 *   1. **`system-sync` is denied outright.** The generic functions would hand it a tenant
 *      constraint, but `03` §6.1 and `11` limit that actor to `people` source-owned fields
 *      in mapped tenants and NOTHING else. A non-human actor with page-write access is
 *      exactly the blast radius the PowerSchool integration is scoped to avoid.
 *
 *   2. **The publish gate.** A `school-manager` cannot transition a page to published by
 *      any route (CLAUDE.md rule 3, `03` §6.4 invariant 5).
 *
 *   3. **The composed-page gate.** `pageType: composed` and its block array are
 *      district-only (`03` §2–3).
 *
 *   4. **Anonymous read is a real, narrow grant** — published and public only — because
 *      that is the website (`03` §6.2). The generic function denies anonymous flatly.
 *
 * Deny by default throughout. Because isolation is enforced here rather than in the
 * database (`02` §4.2), a function that returns `true` on a malformed user is a tenant
 * leak, not a bug report.
 */

const userOf = (req: { user?: unknown }): AuthUser | null => (req?.user as AuthUser) ?? null

/** The incoming payload on a create or update. Absent on reads and deletes. */
type IncomingData = {
  tenant?: unknown
  pageType?: unknown
  publishAt?: unknown
  _status?: unknown
} | null

const dataOf = (args: { data?: unknown }): IncomingData => (args?.data as IncomingData) ?? null

/**
 * Who may transition content to published (`04` §5). District-admin only, in v1 and by
 * design — direct publish is the district's, and a school-manager's save becomes a change
 * request instead.
 */
export const canPublish = (user: AuthUser | null | undefined): boolean => isDistrictAdmin(user)

/**
 * Who may author `composed` pages and their block array (`03` §2–3).
 *
 * Deliberately a single predicate. `01` §4.1 lists school-level composition as a possible
 * add-on; enabling it changes this function and adds editor guardrails, and requires no new
 * collections, blocks, or templates. Keeping the seam this small is the whole point.
 */
export const canComposePages = (user: AuthUser | null | undefined): boolean => isDistrictAdmin(user)

/**
 * What an anonymous caller may see through REST and GraphQL: published, public pages.
 *
 * Exported so the test suite can assert its SHAPE rather than merely its effect — dropping
 * either half of this `and` is a silent leak of drafts or staff-only content, and an
 * assertion that only checked "some constraint was returned" would not notice.
 *
 * The public website does not depend on this. It reads through `src/content/*` with access
 * overridden, at build and revalidate time (`02` §5). This constraint exists so that the
 * API surface is safe on its own terms — `03` §6.4 invariant 4.
 */
export const PUBLIC_PAGE_CONSTRAINT: Where = {
  and: [{ _status: { equals: 'published' } }, { visibility: { equals: 'public' } }],
}

/**
 * Would this write publish something?
 *
 * Covers both routes: the explicit status transition, and `publishAt`, which defers the
 * transition rather than cancelling it. Treating a scheduled publish as anything other than
 * a publish would let a school-manager publish by waiting.
 */
const isPublishingWrite = (data: IncomingData): boolean => {
  if (!data) return false
  if (data._status === 'published') return true
  return data.publishAt !== undefined && data.publishAt !== null && data.publishAt !== ''
}

const isComposedWrite = (data: IncomingData): boolean => data?.pageType === 'composed'

/**
 * READ.
 *
 * district-admin -> true (cross-tenant by design, `04` §3.2)
 * scoped user    -> { tenant: { in: [...] } } — a constraint, NEVER a boolean
 * system-sync    -> false
 * anonymous      -> published + public only
 *
 * Note the deliberate asymmetry: an authenticated school-manager sees their own tenant at
 * every status, and does NOT see other tenants' published pages through this route, while
 * an anonymous caller sees published public pages across tenants. That is not an oversight.
 * The anonymous grant is the public website's content, which is public by definition; the
 * authenticated grant is the admin list view, which must show one school its own work and
 * not the other 27's (`04` §2).
 */
export const pagesReadAccess: Access = ({ req }) => {
  const user = userOf(req)
  if (!user) return PUBLIC_PAGE_CONSTRAINT
  if (isDistrictAdmin(user)) return true
  if (isSystemSync(user)) return false

  const tenantIds = tenantIdsFor(user)
  // Not an empty `in` — some query builders drop those entirely, which fails open.
  if (tenantIds.length === 0) return false

  return { tenant: { in: tenantIds } }
}

/**
 * CREATE.
 *
 * A create has no existing document, so the incoming `data` is the whole of what there is
 * to judge — including `_status`, since a page can be created already published without any
 * update ever happening.
 */
export const pagesCreateAccess: Access = ({ req, data }) => {
  const user = userOf(req)
  if (!user) return false
  if (isSystemSync(user)) return false

  const incoming = dataOf({ data })

  if (isPublishingWrite(incoming) && !canPublish(user)) return false
  if (isComposedWrite(incoming) && !canComposePages(user)) return false

  if (isDistrictAdmin(user)) return true

  const allowed = tenantIdsFor(user)
  if (allowed.length === 0) return false

  const target = tenantIdOf(incoming?.tenant as never)
  if (target === null) return false

  return allowed.includes(target)
}

/**
 * UPDATE.
 *
 * Returns a query constraint for scoped users, for the reason spelled out in
 * `src/access/tenant-scoped.ts`: Payload's access args carry `id` and `data`, not the
 * existing document, so a boolean written against `data` alone is satisfied by a partial
 * update that omits `tenant`. A constraint makes the database the arbiter — a scoped user
 * reaches only rows already inside their tenants, whatever the payload claims.
 *
 * The publish and composed gates are checked BEFORE the constraint is returned, so they
 * apply to a user's own tenant too. "It is their page" is not permission to publish it.
 */
export const pagesUpdateAccess: Access = ({ req, data }) => {
  const user = userOf(req)
  if (!user) return false
  if (isSystemSync(user)) return false

  const incoming = dataOf({ data })

  if (isPublishingWrite(incoming) && !canPublish(user)) return false
  if (isComposedWrite(incoming) && !canComposePages(user)) return false

  if (isDistrictAdmin(user)) return true

  const tenantIds = tenantIdsFor(user)
  if (tenantIds.length === 0) return false

  return { tenant: { in: tenantIds } }
}

/**
 * DELETE — district-admin only (`03` §6.2).
 *
 * A school-manager edits and submits; removing a page from the site is a publishing
 * decision in the same family as publishing one, and belongs with the same role.
 */
export const pagesDeleteAccess: Access = ({ req }) => isDistrictAdmin(userOf(req))
