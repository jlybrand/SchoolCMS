import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionAfterLoginHook,
  PayloadRequest,
} from 'payload'

import { auditEntries, type AuditInput } from '@/lib/audit'

/**
 * Writes the audit entries `auditEntries` decides on (`04` §8). The decision is
 * `src/lib/audit.ts`; this is the adapter.
 *
 * IN THE SAME TRANSACTION AS THE CHANGE, and a failed write FAILS THE CHANGE. "Invisible
 * approval, never invisible change" (`04` §4.3): an approval the trail cannot record does not
 * happen. Passing `req` puts the insert in the operation's transaction, so a throw here rolls
 * the change back. Unlike the emails, which never fail a write — losing an email is a nuisance,
 * losing the record is the thing this exists to prevent.
 *
 * Registered FIRST in each collection's after-hooks, so nothing else (a revalidation, an email)
 * acts on a change that is about to be rolled back.
 *
 * Written as the platform: `audit-events` refuses every create through the API, by design.
 */

export const AUDIT_COLLECTION = 'audit-events'

const write = async (req: PayloadRequest, input: AuditInput) => {
  for (const entry of auditEntries(input)) {
    await req.payload.create({
      collection: AUDIT_COLLECTION,
      data: {
        ...entry,
        tenant: entry.tenant === null ? null : Number(entry.tenant),
        actor: entry.actor === null ? null : Number(entry.actor),
      },
      req,
      overrideAccess: true,
    })
  }
}

const userOf = (req: PayloadRequest) => (req.user as AuditInput['user']) ?? null

export const auditChange =
  (collection: string): CollectionAfterChangeHook =>
  async ({ doc, previousDoc, operation, req }) => {
    await write(req, {
      collection,
      operation,
      previous: operation === 'create' ? null : previousDoc,
      doc,
      user: userOf(req),
      restoring: req.context?.isRestoringVersion === true,
    })
    return doc
  }

export const auditDelete =
  (collection: string): CollectionAfterDeleteHook =>
  async ({ doc, req }) => {
    await write(req, {
      collection,
      operation: 'delete',
      previous: doc,
      doc,
      user: userOf(req),
    })
    return doc
  }

/**
 * Every successful sign-in (Jason, 2026-10-27). Payload runs `afterLogin` only on success; a
 * failed attempt is not recorded here.
 */
export const auditLogin: CollectionAfterLoginHook = async ({ user, req }) => {
  await write(req, {
    collection: 'users',
    operation: 'login',
    previous: null,
    doc: user as Record<string, unknown>,
    user: user as AuditInput['user'],
  })
  return user
}
