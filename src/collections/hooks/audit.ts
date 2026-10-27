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

/**
 * Whether `id` is a stored user. A request can carry an identity that is not one: the seed puts
 * a synthetic district admin (`{ id: 0 }`) on its request so the publish gate lets it seed
 * published pages, and a user deleting their own account is gone by the time the entry is
 * written. Recording either id would break the foreign key and — the trail failing closed —
 * the write with it.
 */
const isStoredUser = async (req: PayloadRequest, id: string): Promise<boolean> => {
  const found = await req.payload.findByID({
    collection: 'users',
    id,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
    req,
  })
  return Boolean(found)
}

const write = async (req: PayloadRequest, input: AuditInput) => {
  const entries = auditEntries(input)
  if (entries.length === 0) return
  const stored = new Map<string, boolean>()
  for (const entry of entries) {
    if (entry.actor !== null) {
      if (!stored.has(entry.actor)) stored.set(entry.actor, await isStoredUser(req, entry.actor))
      if (!stored.get(entry.actor)) {
        // No row to link to. Someone deleting their own account still has an address to keep;
        // the seed's synthetic identity has none.
        const email = input.user?.email
        entry.actor = null
        if (typeof email !== 'string' || email.trim() === '') entry.actorLabel = 'System'
      }
    }
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
