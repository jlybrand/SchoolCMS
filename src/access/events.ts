import type { Access, Where } from 'payload'

import { canPublish } from './pages'
import { isDistrictAdmin, isSystemSync, tenantIdOf, tenantIdsFor } from './predicates'
import type { AuthUser } from './types'

/**
 * Access functions for `events` — calendar events (`03` §2, §6.2; Jason, 2026-11-11).
 *
 * The rules are posts' (src/access/posts.ts, which explains each one), with two differences
 * that both make the rule SMALLER:
 *
 *   - An event has no Start date of its own. Its `start` is when the event happens, not when
 *     it goes live, so only `_status` is a publishing write.
 *   - An event has no staff-only setting (Finalsite's event form has none that DD2 uses), so
 *     anonymous read is the status alone (`03` §6.4 invariant 4).
 *
 * CALENDARS ARE NOT A READ GRANT HERE. A calendar block on one site may show another site's
 * calendars — reach chosen by the district on the block, as a news feed's boards are — and it
 * is the PUBLIC site that reads them, through `src/content/events.ts`. A signed-in school manager
 * keeps to their own school in the admin.
 */

const userOf = (req: { user?: unknown }): AuthUser | null => (req?.user as AuthUser) ?? null

type IncomingData = { tenant?: unknown; _status?: unknown } | null

const dataOf = (args: { data?: unknown }): IncomingData => (args?.data as IncomingData) ?? null

/** What an anonymous caller may see through REST and GraphQL. Exported so its shape is tested. */
export const PUBLIC_EVENT_CONSTRAINT: Where = { _status: { equals: 'published' } }

const isPublishingWrite = (data: IncomingData): boolean => data?._status === 'published'

export const eventsReadAccess: Access = ({ req }) => {
  const user = userOf(req)
  if (!user) return PUBLIC_EVENT_CONSTRAINT
  if (isDistrictAdmin(user)) return true
  if (isSystemSync(user)) return false

  const tenantIds = tenantIdsFor(user)
  if (tenantIds.length === 0) return false

  return { tenant: { in: tenantIds } }
}

export const eventsCreateAccess: Access = ({ req, data }) => {
  const user = userOf(req)
  if (!user) return false
  if (isSystemSync(user)) return false

  const incoming = dataOf({ data })
  if (isPublishingWrite(incoming) && !canPublish(user)) return false

  if (isDistrictAdmin(user)) return true

  const allowed = tenantIdsFor(user)
  if (allowed.length === 0) return false

  const target = tenantIdOf(incoming?.tenant as never)
  if (target === null) return false

  return allowed.includes(target)
}

/** A constraint for scoped users — see `pagesUpdateAccess` for why a boolean would leak. */
export const eventsUpdateAccess: Access = ({ req, data }) => {
  const user = userOf(req)
  if (!user) return false
  if (isSystemSync(user)) return false

  if (isPublishingWrite(dataOf({ data })) && !canPublish(user)) return false

  if (isDistrictAdmin(user)) return true

  const tenantIds = tenantIdsFor(user)
  if (tenantIds.length === 0) return false

  return { tenant: { in: tenantIds } }
}

/** Taking an event down is a publishing decision, as for pages and posts. */
export const eventsDeleteAccess: Access = ({ req }) => isDistrictAdmin(userOf(req))

/** The version history is the district's, as for pages (Jason, 2026-10-27). */
export const eventsReadVersionsAccess: Access = ({ req }) => isDistrictAdmin(userOf(req))
