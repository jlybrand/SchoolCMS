import { isSchoolManager } from './predicates'
import type { AuthUser } from './types'

/**
 * Auto-approval — off by default, granted per editor (`04` §4.3).
 *
 * A grant is a statement about a PERSON: a district admin puts a scope on one school manager's
 * `users.autoApprove`. Nothing else grants it — not a role, a school or a content type — so a
 * user without a known scope in that field queues, always.
 *
 * PURE. Each collection declares its rules in `AUTO_APPROVAL_RULES`; this decides. The order is
 * the spec's: the never-auto-approvable list is checked before any scope, and a scope must
 * permit the WHOLE change, so a mixed submission queues in full. A rule that throws queues.
 *
 * TODAY NOTHING AUTO-APPROVES. Both scopes the spec defines are for posts and events, which
 * arrive in Phase 5 and add their rules here; `pages` has none, and page creation is never
 * auto-approvable. Acting on an approve — publishing on the submitter's behalf, audited and
 * flagged as auto-approved — lands with the first collection that has a scope.
 */

export type GrantScope = 'events:schedule' | 'posts:routine'

/** The grantable scopes, with the label the users form shows. `users.autoApprove` reads this. */
export const GRANT_SCOPES: readonly { value: GrantScope; label: string }[] = [
  { value: 'events:schedule', label: 'Events: schedule-only changes' },
  { value: 'posts:routine', label: 'Posts: routine posts' },
] as const

/** What a submission changes, as the collection's hook describes it. */
export type Change = {
  collection: string
  isCreate: boolean
  /** Top-level field names that differ from the published document. */
  changedFields: readonly string[]
  requiresTranslationReview: boolean
}

export type ScopeRule = {
  scope: GrantScope
  /** Whether this scope covers the ENTIRE change. Never true for part of one. */
  permits: (change: Change) => boolean
}

export type CollectionRules = {
  /**
   * Fields whose change is never auto-approvable, regardless of grant: rich text, uploads,
   * visibility, SEO, navigation placement, syndication, page type (`04` §4.3).
   */
  neverFields: readonly string[]
  /** Whether creating a document can ever be auto-approved. */
  createAllowed: boolean
  scopes: readonly ScopeRule[]
}

export type AutoApprovalRules = Readonly<Record<string, CollectionRules>>

export const AUTO_APPROVAL_RULES: AutoApprovalRules = {
  /**
   * No scope covers a page. `body` and `layout` are content (rich text, blocks); `parent`
   * places the page in the site's navigation; `pageType`, `visibility` and `meta` (SEO) are
   * named by the spec. `tests/unit/access/auto-approval.test.ts` fails if a rich-text, upload
   * or block field is added to pages without joining this list.
   */
  pages: {
    neverFields: ['body', 'layout', 'pageType', 'parent', 'visibility', 'meta'],
    createAllowed: false,
    scopes: [],
  },
}

export type QueueReason =
  | 'not-a-school-manager'
  | 'no-grant'
  | 'translation-review'
  | 'new-document'
  | 'never-field'
  | 'nothing-changed'
  | 'outside-every-scope'

export type AutoApprovalDecision =
  { approve: true; scope: GrantScope } | { approve: false; reason: QueueReason }

const KNOWN = new Set<string>(GRANT_SCOPES.map((s) => s.value))

/** The known scopes in a user's `autoApprove`, once each. Anything malformed grants nothing. */
export const grantsOf = (user: AuthUser | null | undefined): GrantScope[] => {
  const raw = user?.autoApprove
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((s): s is GrantScope => typeof s === 'string' && KNOWN.has(s)))]
}

/**
 * The scopes a user holds that the collection defines. Empty means the submission queues, and
 * a hook can stop there without working out what changed.
 */
export const applicableScopes = (
  user: AuthUser | null | undefined,
  collection: string,
  rules: AutoApprovalRules = AUTO_APPROVAL_RULES,
): GrantScope[] => {
  if (!isSchoolManager(user)) return []
  const defined = new Set((rules[collection]?.scopes ?? []).map((r) => r.scope))
  return grantsOf(user).filter((scope) => defined.has(scope))
}

const permitsSafely = (rule: ScopeRule, change: Change): boolean => {
  try {
    return rule.permits(change) === true
  } catch {
    return false
  }
}

const queue = (reason: QueueReason): AutoApprovalDecision => ({ approve: false, reason })

/** Whether a school manager's submission skips the queue, and under which grant. */
export const decideAutoApproval = ({
  user,
  change,
  rules = AUTO_APPROVAL_RULES,
}: {
  user: AuthUser | null | undefined
  change: Change
  rules?: AutoApprovalRules
}): AutoApprovalDecision => {
  // The district publishes directly; the sync and trusted server code never submit.
  if (!isSchoolManager(user)) return queue('not-a-school-manager')

  const scopes = applicableScopes(user, change.collection, rules)
  const collection = rules[change.collection]
  if (scopes.length === 0 || !collection) return queue('no-grant')

  if (change.requiresTranslationReview) return queue('translation-review')
  if (change.isCreate && !collection.createAllowed) return queue('new-document')
  if (change.changedFields.some((f) => collection.neverFields.includes(f))) {
    return queue('never-field')
  }
  if (change.changedFields.length === 0) return queue('nothing-changed')

  const rule = collection.scopes.find((r) => scopes.includes(r.scope) && permitsSafely(r, change))
  return rule ? { approve: true, scope: rule.scope } : queue('outside-every-scope')
}
