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
 * `posts.routine` is the first scope that acts (Jason, 2026-10-28) — the publish on the sender's
 * behalf is `src/collections/hooks/auto-approve.ts`. `events.schedule` arrives with events;
 * `pages` has no scope, and page creation is never auto-approvable.
 */

export type GrantScope = 'events.schedule' | 'posts.routine'

/** The grantable scopes, with the label the users form shows. `users.autoApprove` reads this. */
export const GRANT_SCOPES: readonly { value: GrantScope; label: string }[] = [
  { value: 'events.schedule', label: 'Events: schedule-only changes' },
  { value: 'posts.routine', label: 'Posts: routine posts' },
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
   * visibility, SEO, navigation placement, syndication (`04` §4.3).
   */
  neverFields: readonly string[]
  /** Whether creating a document can ever be auto-approved. */
  createAllowed: boolean
  scopes: readonly ScopeRule[]
}

export type AutoApprovalRules = Readonly<Record<string, CollectionRules>>

export const AUTO_APPROVAL_RULES: AutoApprovalRules = {
  /**
   * No scope covers a page. `layout` is its content (its sections, words included); `parent`
   * places the page in the site's navigation; `visibility` and `meta` (SEO) are named by the
   * spec. `tests/unit/access/auto-approval.test.ts` fails if a rich-text, upload
   * or block field is added to pages without joining this list.
   */
  pages: {
    neverFields: ['layout', 'parent', 'visibility', 'meta'],
    createAllowed: false,
    scopes: [],
  },
  /**
   * `posts.routine` (`04` §4.3; Jason, 2026-10-28, option 1). A NARROW EXCEPTION to "never rich
   * text": an announcement's own `body` may be auto-approved under this grant — the routine news
   * the grant exists for (picture day, a bake sale) is words. Everything else on the spec's never
   * list still queues the whole submission: `heroImage` (an upload, Phase 6), `visibility`,
   * `syndication`, `publishedDate` (district-set), `requiresTranslationReview`. Rich text stays
   * never-auto-approvable everywhere else.
   *
   * A new announcement may be auto-approved — its address is its first. Moving a live one to a
   * new address may not: that breaks every link to it, which is a page-structure change.
   */
  posts: {
    neverFields: [
      'heroImage',
      'visibility',
      'syndication',
      'publishedDate',
      'requiresTranslationReview',
    ],
    createAllowed: true,
    scopes: [
      {
        scope: 'posts.routine',
        permits: ({ isCreate, changedFields }) => isCreate || !changedFields.includes('slug'),
      },
    ],
  },
}

/** The announcement fields a submission is judged on — everything an editor can write. */
export const POST_JUDGED_FIELDS: readonly string[] = [
  'title',
  'slug',
  'board',
  'tags',
  'excerpt',
  'body',
  'heroImage',
  'visibility',
  'publishedDate',
  'syndication',
  'requiresTranslationReview',
] as const

/** What a never-published announcement starts as — "unchanged" for a new one means these. */
export const NEW_POST_BASELINE: Readonly<Record<string, unknown>> = {
  visibility: 'public',
  syndication: { scope: 'this-tenant' },
  requiresTranslationReview: false,
}

/** A value as a comparison key: relationships to ids, id lists sorted, empty as nothing. */
const keyOf = (value: unknown): string => {
  const norm = (v: unknown): unknown => {
    if (v === null || v === undefined || v === '' || v === false) return null
    if (Array.isArray(v)) {
      const items = v.map(norm).filter((i) => i !== null)
      if (items.length === 0) return null
      // A list of ids is a set: the order things were ticked in is not a change.
      return items.every((i) => typeof i === 'string') ? [...(items as string[])].sort() : items
    }
    if (typeof v === 'number') return String(v)
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      // A populated relationship is its id.
      if ('id' in o && (typeof o.id === 'number' || typeof o.id === 'string')) return String(o.id)
      const entries = Object.entries(o)
        .map(([k, x]) => [k, norm(x)] as const)
        .filter(([, x]) => x !== null)
        .sort(([a], [b]) => a.localeCompare(b))
      return entries.length === 0 ? null : Object.fromEntries(entries)
    }
    return v
  }
  return JSON.stringify(norm(value))
}

/**
 * The fields, of `fields`, whose values differ between `before` and `after`, in field order.
 * Pure. A populated relationship equals its id, a set of ids equals itself in any order, and
 * missing, null, empty and `false` are the same. An unset field takes its value from `defaults`,
 * so a new post's unset sharing reads as the "this site" it is.
 */
export const changedFields = (
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  /** A field's value when unset — e.g. `NEW_POST_BASELINE` — so unset equals its default. */
  defaults: Readonly<Record<string, unknown>> = {},
): string[] => {
  const value = (doc: Readonly<Record<string, unknown>>, field: string) =>
    doc[field] === null || doc[field] === undefined ? defaults[field] : doc[field]
  return fields.filter((field) => keyOf(value(before, field)) !== keyOf(value(after, field)))
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
