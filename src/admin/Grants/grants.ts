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

/** One auto-approved change on the district's 30-day spot-check list (`04` §4.3). */
export type AutoApprovalRow = {
  id: string
  title: string
  /** Its form in the admin, or null when there is no document to open. */
  href: string | null
  who: string
  when: string
}

type AuditRow = {
  id: unknown
  action?: unknown
  autoApproved?: unknown
  contentType?: unknown
  documentId?: unknown
  documentTitle?: unknown
  actorLabel?: unknown
  createdAt?: unknown
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * Audit entries → the spot-check list: auto-approvals only, newest first. The audit trail is the
 * record ("invisible approval, never invisible change"); this only reads it. Pure.
 */
export const autoApprovalRows = (
  entries: readonly AuditRow[],
  timeZone: string,
): AutoApprovalRow[] =>
  entries
    .filter((e) => e.action === 'auto-approve' && e.autoApproved === true)
    .map((e) => ({ e, at: new Date(text(e.createdAt)) }))
    .filter(({ at }) => !Number.isNaN(at.getTime()))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map(({ e, at }) => {
      const collection = text(e.contentType)
      const documentId = text(e.documentId)
      return {
        id: String(e.id),
        title: text(e.documentTitle) || 'Untitled',
        href: collection && documentId ? `/admin/collections/${collection}/${documentId}` : null,
        who: text(e.actorLabel) || 'Unknown',
        when: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone }).format(
          at,
        ),
      }
    })
