import type { Access, Where } from 'payload'

import { canPublish } from './pages'
import { isDistrictAdmin, isSystemSync, tenantIdOf, tenantIdsFor } from './predicates'
import type { AuthUser } from './types'

/**
 * Access functions for `posts` — news and announcements (`03` §2, §6.2).
 *
 * The rules are `pages`' (src/access/pages.ts, which explains each one) less the composed-page
 * gate, which posts have no equivalent of:
 *
 *   - `system-sync` is denied outright; it owns `people` source fields and nothing else (`11`).
 *   - A `school-manager` cannot publish by any route (CLAUDE.md rule 3). Same predicate,
 *     `canPublish`, so the two collections cannot disagree about who publishes.
 *   - Anonymous read is published and public only (`03` §6.4 invariant 4).
 *
 * SYNDICATION IS NOT A READ GRANT HERE. `03` §6.4 invariant 3 makes syndicated published
 * content the one cross-tenant read, and it is the PUBLIC site that reads it — through
 * `src/content/posts.ts`, which asks for exactly the posts that reach a tenant
 * (`src/content/syndication.ts`). Through the API, a published public post is already readable
 * by anyone, so syndication widens nothing there; a signed-in school manager keeps to their own
 * school, as with pages, so the admin shows one school its own work. Who may SET syndication is
 * field-level, in src/collections/Posts.ts.
 */

const userOf = (req: { user?: unknown }): AuthUser | null => (req?.user as AuthUser) ?? null

type IncomingData = { tenant?: unknown; _status?: unknown } | null

const dataOf = (args: { data?: unknown }): IncomingData => (args?.data as IncomingData) ?? null

/** What an anonymous caller may see through REST and GraphQL. Exported so its shape is tested. */
export const PUBLIC_POST_CONSTRAINT: Where = {
  and: [{ _status: { equals: 'published' } }, { visibility: { equals: 'public' } }],
}

/** Posts have no `publishAt`; the one publishing write is the status. */
const isPublishingWrite = (data: IncomingData): boolean => data?._status === 'published'

export const postsReadAccess: Access = ({ req }) => {
  const user = userOf(req)
  if (!user) return PUBLIC_POST_CONSTRAINT
  if (isDistrictAdmin(user)) return true
  if (isSystemSync(user)) return false

  const tenantIds = tenantIdsFor(user)
  if (tenantIds.length === 0) return false

  return { tenant: { in: tenantIds } }
}

export const postsCreateAccess: Access = ({ req, data }) => {
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
export const postsUpdateAccess: Access = ({ req, data }) => {
  const user = userOf(req)
  if (!user) return false
  if (isSystemSync(user)) return false

  if (isPublishingWrite(dataOf({ data })) && !canPublish(user)) return false

  if (isDistrictAdmin(user)) return true

  const tenantIds = tenantIdsFor(user)
  if (tenantIds.length === 0) return false

  return { tenant: { in: tenantIds } }
}

/** Taking a post down is a publishing decision, as for pages. */
export const postsDeleteAccess: Access = ({ req }) => isDistrictAdmin(userOf(req))

/** The version history is the district's, as for pages (Jason, 2026-10-27). */
export const postsReadVersionsAccess: Access = ({ req }) => isDistrictAdmin(userOf(req))
