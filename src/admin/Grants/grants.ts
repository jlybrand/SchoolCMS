import { GRANT_SCOPES, grantsOf } from '@/access/auto-approval'
import type { AuthUser } from '@/access/types'

/**
 * Who holds which auto-approval grant, for the district dashboard (`04` §4.3: "an inherited
 * grant from a previous administrator is visible rather than forgotten"). Pure; the panel
 * renders it.
 */

export type GrantHolder = AuthUser & { name?: string | null; email?: string | null }

export type GrantRow = { userId: string; person: string; grants: string[] }

const LABELS = new Map<string, string>(GRANT_SCOPES.map((s) => [s.value, s.label]))

/** One row per person holding at least one known scope, sorted by how they are named. */
export const grantRows = (users: readonly GrantHolder[]): GrantRow[] =>
  users
    .map((user) => ({
      userId: String(user.id),
      person: user.name?.trim() || user.email?.trim() || `User ${user.id}`,
      grants: grantsOf(user).map((scope) => LABELS.get(scope) ?? scope),
    }))
    .filter((row) => row.grants.length > 0)
    .sort((a, b) => a.person.localeCompare(b.person))
