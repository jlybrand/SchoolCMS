import type { Access, Where } from 'payload'

import { isDistrictAdmin, isSystemSync, tenantIdOf, tenantIdsFor } from './predicates'
import type { AuthUser } from './types'

/**
 * Access functions for `events` — calendar events (`03` §2, §6.2; Jason, 2026-11-11).
 *
 * ============================================================================
 * EVENTS DO NOT GO THROUGH APPROVAL (Jason, 2026-11-11).
 * A school manager publishes, changes and removes their OWN school's events directly.
 * ============================================================================
 *
 * This lifts CLAUDE.md rule 3 ("a school-manager cannot publish by any route") and rule 8 (no
 * approval-free route by role) for events, and only events, by Jason's decision — the way his
 * school-composition decision lifted the no-composition rule for pages. Pages and announcements
 * keep both rules. What does NOT change is isolation: every write by a scoped user is a tenant
 * constraint or a tenant check, so another school's events stay out of reach (invariant 2), and
 * an event goes only on its own school's calendar (`eventCalendarIsThisSites`).
 *
 * The district hears about school events through the activity log (`auditChange('events')`),
 * not a queue or an email (Jason, 2026-11-11).
 *
 *   - `system-sync` is denied outright; it owns `people` source fields and nothing else (`11`).
 *   - Anonymous read is published only: an event has no staff-only setting (`03` §6.4 inv. 4).
 */

const userOf = (req: { user?: unknown }): AuthUser | null => (req?.user as AuthUser) ?? null

/** What an anonymous caller may see through REST and GraphQL. Exported so its shape is tested. */
export const PUBLIC_EVENT_CONSTRAINT: Where = { _status: { equals: 'published' } }

/** The district: everywhere. A school manager: their schools, as a constraint. Others: nothing. */
const ownSchools: Access = ({ req }) => {
  const user = userOf(req)
  if (!user) return false
  if (isDistrictAdmin(user)) return true
  if (isSystemSync(user)) return false

  const tenantIds = tenantIdsFor(user)
  if (tenantIds.length === 0) return false

  return { tenant: { in: tenantIds } }
}

export const eventsReadAccess: Access = (args) =>
  userOf(args.req) ? ownSchools(args) : PUBLIC_EVENT_CONSTRAINT

/** A create has no stored document to constrain, so the target school is checked directly. */
export const eventsCreateAccess: Access = ({ req, data }) => {
  const user = userOf(req)
  if (!user) return false
  if (isSystemSync(user)) return false
  if (isDistrictAdmin(user)) return true

  const allowed = tenantIdsFor(user)
  if (allowed.length === 0) return false

  const target = tenantIdOf((data as { tenant?: unknown } | undefined)?.tenant as never)
  if (target === null) return false

  return allowed.includes(target)
}

/** A constraint for scoped users — see `pagesUpdateAccess` for why a boolean would leak. */
export const eventsUpdateAccess: Access = ownSchools

/** A cancelled game comes off the calendar without asking anyone (Jason, 2026-11-11). */
export const eventsDeleteAccess: Access = ownSchools

/** The version history is the district's, as for pages (Jason, 2026-10-27). */
export const eventsReadVersionsAccess: Access = ({ req }) => isDistrictAdmin(userOf(req))
