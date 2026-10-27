import { GRANT_SCOPES } from '@/access/auto-approval'
import { relationshipIdOf, tenantIdOf } from '@/access/predicates'

/**
 * Which audit entries a write produces (`04` §8, `03` §7, `09` §6). Pure; the hooks in
 * `src/collections/hooks/audit.ts` write what this returns.
 *
 * WHAT IS RECORDED: every approval-path action on content — submit, request changes, approve,
 * publish, restore, delete, and (from Phase 5) auto-approve — and every change to who may do
 * what: a user created, deleted, or changed in role, school or alert setting, and an
 * auto-approval grant changed. Ordinary edits are not: Payload's versions already hold them.
 *
 * NEVER A SECRET. User entries read only the fields named in `USER_FIELDS`; a password, hash,
 * salt or token cannot reach a summary because nothing here reads one.
 *
 * Who: the signed-in user, by id, with their email as it was then (a user can be deleted; the
 * entry must still say who). No user means trusted server code — the seed, a script, the
 * Phase 9 import — recorded as "System".
 */

export type AuditAction =
  | 'submit'
  | 'request-changes'
  | 'approve'
  | 'auto-approve'
  | 'publish'
  | 'restore'
  | 'delete'
  | 'user-create'
  | 'user-change'
  | 'user-delete'
  | 'grant-change'

export type AuditEntry = {
  action: AuditAction
  /** The collection slug — "content type" in `04` §8. */
  contentType: string
  documentId: string
  /** The document's title as it was, so the entry reads after the document is gone. */
  documentTitle: string
  tenant: string | null
  actor: string | null
  actorLabel: string
  summary: string
  autoApproved: boolean
}

type Doc = Record<string, unknown> | null | undefined

export type AuditInput = {
  collection: string
  operation: 'create' | 'update' | 'delete'
  previous: Doc
  doc: Doc
  user: { id: string | number; email?: unknown } | null | undefined
  /** Payload's `req.context.isRestoringVersion`. */
  restoring?: boolean
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const who = (user: AuditInput['user']) =>
  user
    ? { actor: String(user.id), actorLabel: text(user.email) || `User ${user.id}` }
    : { actor: null, actorLabel: 'System' }

const entry = (
  input: AuditInput,
  doc: NonNullable<Doc>,
  action: AuditAction,
  fields: { documentTitle: string; tenant: string | null; summary?: string },
): AuditEntry => ({
  action,
  contentType: input.collection,
  documentId: String(doc.id),
  documentTitle: fields.documentTitle,
  tenant: fields.tenant,
  ...who(input.user),
  summary: fields.summary ?? '',
  autoApproved: action === 'auto-approve',
})

const pageAction = (input: AuditInput): AuditAction | null => {
  const before = input.previous ?? {}
  const after = input.doc ?? {}
  if (input.operation === 'delete') return 'delete'
  if (input.restoring) return 'restore'
  if (after._status === 'published') {
    return before.reviewState === 'submitted' ? 'approve' : 'publish'
  }
  if (after.reviewState === 'changes-requested' && before.reviewState === 'submitted') {
    return 'request-changes'
  }
  if (after.reviewState === 'submitted' && before.reviewState !== 'submitted') return 'submit'
  return null
}

const forPage = (input: AuditInput): AuditEntry[] => {
  const doc = input.doc
  if (!doc) return []
  const action = pageAction(input)
  if (!action) return []
  return [
    entry(input, doc, action, {
      documentTitle: text(doc.title) || `Page ${String(doc.id)}`,
      tenant: tenantIdOf(doc.tenant as never),
      summary: action === 'request-changes' ? text(doc.reviewNote) : '',
    }),
  ]
}

/** The only user fields the trail reads. Everything else on a user is bookkeeping or secret. */
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

const schoolIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((row) => relationshipIdOf((row as { tenant?: unknown })?.tenant as never))
        .filter((id): id is string => id !== null)
        .sort()
    : []

const GRANT_LABELS = new Map<string, string>(GRANT_SCOPES.map((s) => [s.value, s.label]))
const grants = (value: unknown) => {
  const labels = list(value).map((scope) => GRANT_LABELS.get(scope) ?? scope)
  return labels.length === 0 ? 'none' : labels.join(', ')
}
const roles = (value: unknown) => list(value).join(', ') || 'none'
const alerts = (value: unknown) => (value === false ? 'off' : 'on')
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

const forUser = (input: AuditInput): AuditEntry[] => {
  const doc = input.operation === 'delete' ? (input.doc ?? input.previous) : input.doc
  if (!doc) return []
  const fields = {
    documentTitle: text(doc.name) || text(doc.email) || `User ${String(doc.id)}`,
    tenant: null,
  }

  if (input.operation === 'delete') return [entry(input, doc, 'user-delete', fields)]
  if (input.operation === 'create' || !input.previous) {
    return [entry(input, doc, 'user-create', { ...fields, summary: `Roles: ${roles(doc.roles)}` })]
  }

  const before = input.previous
  const changes: string[] = []
  if (!same(list(before.roles), list(doc.roles))) {
    changes.push(`Roles: ${roles(before.roles)} → ${roles(doc.roles)}`)
  }
  if (!same(schoolIds(before.tenants), schoolIds(doc.tenants))) changes.push('Schools changed')
  if (alerts(before.receivesAlerts) !== alerts(doc.receivesAlerts)) {
    changes.push(`Alert emails: ${alerts(before.receivesAlerts)} → ${alerts(doc.receivesAlerts)}`)
  }
  if (text(before.email) !== text(doc.email)) changes.push('Email address changed')

  const entries: AuditEntry[] = []
  if (changes.length > 0) {
    entries.push(entry(input, doc, 'user-change', { ...fields, summary: changes.join('; ') }))
  }
  if (grants(before.autoApprove) !== grants(doc.autoApprove)) {
    entries.push(
      entry(input, doc, 'grant-change', {
        ...fields,
        summary: `Auto-approval: ${grants(before.autoApprove)} → ${grants(doc.autoApprove)}`,
      }),
    )
  }
  return entries
}

/** The entries a write produces; empty for anything the trail does not record. */
export const auditEntries = (input: AuditInput): AuditEntry[] => {
  if (input.collection === 'pages') return forPage(input)
  if (input.collection === 'users') return forUser(input)
  return []
}
