import { describe, expect, it } from 'vitest'

import {
  AUTO_APPROVAL_RULES,
  GRANT_SCOPES,
  applicableScopes,
  changedFields,
  decideAutoApproval,
  NEW_POST_BASELINE,
  grantsOf,
  type AutoApprovalRules,
  type Change,
} from '@/access/auto-approval'
import type { AuthUser } from '@/access/types'
import { Pages } from '@/collections/Pages'
import { Posts } from '@/collections/Posts'

/**
 * The auto-approval grant boundary (`04` §4.3) — one of the five 100%-intent areas in `06` §7.
 *
 * NOTHING AUTO-APPROVES WITHOUT AN EXPLICIT GRANT on the person sending it. A grant is never
 * implied by role, school or content type, and a submission that mixes a permitted change with
 * anything else queues in full.
 *
 * The framework is proven here against a synthetic rule table, so its edges do not depend on
 * what `posts.routine` happens to permit; the real table is checked separately. `events.schedule`
 * is gone (Jason, 2026-11-11: events skip approval) — a leftover value grants nothing.
 */

const manager = (autoApprove: unknown = []): AuthUser =>
  ({
    id: 'm1',
    roles: ['school-manager'],
    tenants: [{ tenant: 'A' }],
    autoApprove,
  }) as AuthUser

const districtAdmin = { id: 'd1', roles: ['district-admin'], autoApprove: ['posts.routine'] }
const sync = { id: 's1', roles: ['system-sync'], autoApprove: ['posts.routine'] }

/** Synthetic rules: `posts` with a narrow routine scope, and `widgets` with no scope at all. */
const rules: AutoApprovalRules = {
  posts: {
    neverFields: ['body', 'image', 'meta'],
    createAllowed: true,
    scopes: [
      {
        scope: 'posts.routine',
        permits: ({ changedFields }) =>
          changedFields.every((f) => ['title', 'excerpt'].includes(f)),
      },
    ],
  },
  widgets: { neverFields: [], createAllowed: true, scopes: [] },
}

const change = (overrides: Partial<Change> = {}): Change => ({
  collection: 'posts',
  isCreate: false,
  changedFields: ['title', 'excerpt'],
  requiresTranslationReview: false,
  ...overrides,
})

const decide = (user: AuthUser | null, c: Change = change()) =>
  decideAutoApproval({ user, change: c, rules })

describe('decideAutoApproval — the grant boundary', () => {
  it('a manager holding the matching grant, making only that change, is auto-approved', () => {
    expect(decide(manager(['posts.routine']))).toEqual({ approve: true, scope: 'posts.routine' })
  })

  it('with NO grants issued, every submission queues, for every collection', () => {
    for (const collection of ['widgets', 'posts', 'pages']) {
      expect(decide(manager([]), change({ collection }))).toEqual({
        approve: false,
        reason: 'no-grant',
      })
    }
  })

  it.each([
    ['a missing field', undefined],
    ['null', null],
    ['a string, not a list', 'posts.routine'],
    ['an unknown scope', ['posts:everything']],
    ['a near miss', ['Posts:Routine']],
    ['a leftover events.schedule (removed 2026-11-11)', ['events.schedule']],
    ['a wildcard', ['*']],
  ])('%s grants nothing', (_label, autoApprove) => {
    expect(decide(manager(autoApprove))).toEqual({ approve: false, reason: 'no-grant' })
  })

  it.each([
    ['a district admin', districtAdmin],
    ['the sync account', sync],
    ['no user', null],
  ])('%s is never auto-approved, whatever the field holds', (_label, user) => {
    expect(decide(user as AuthUser | null)).toEqual({
      approve: false,
      reason: 'not-a-school-manager',
    })
  })

  it('a grant for one collection does nothing for another', () => {
    expect(decide(manager(['posts.routine']), change({ collection: 'widgets' }))).toEqual({
      approve: false,
      reason: 'no-grant',
    })
  })

  it('a collection with no rules at all queues', () => {
    expect(decide(manager(['posts.routine']), change({ collection: 'documents' }))).toEqual({
      approve: false,
      reason: 'no-grant',
    })
  })

  it('a MIXED submission queues in full — no partial approval', () => {
    expect(
      decide(manager(['posts.routine']), change({ changedFields: ['title', 'tags'] })),
    ).toEqual({ approve: false, reason: 'outside-every-scope' })
  })

  it('a never-auto-approvable field queues even when a scope would permit everything', () => {
    expect(decide(manager(['posts.routine']), change({ changedFields: ['body'] }))).toEqual({
      approve: false,
      reason: 'never-field',
    })
  })

  it('one never field among permitted ones still queues the whole submission', () => {
    expect(
      decide(manager(['posts.routine']), change({ changedFields: ['title', 'body'] })),
    ).toEqual({ approve: false, reason: 'never-field' })
  })

  it('anything on a page flagged for translation review queues', () => {
    expect(decide(manager(['posts.routine']), change({ requiresTranslationReview: true }))).toEqual(
      { approve: false, reason: 'translation-review' },
    )
  })

  it('a create queues where the collection does not allow auto-approved creation', () => {
    const noCreate: AutoApprovalRules = { posts: { ...rules.posts!, createAllowed: false } }
    expect(
      decideAutoApproval({
        user: manager(['posts.routine']),
        change: change({ isCreate: true }),
        rules: noCreate,
      }),
    ).toEqual({ approve: false, reason: 'new-document' })
  })

  it('a send with nothing changed queues — there is nothing for a grant to cover', () => {
    expect(decide(manager(['posts.routine']), change({ changedFields: [] }))).toEqual({
      approve: false,
      reason: 'nothing-changed',
    })
  })

  it('a rule that throws queues rather than approving', () => {
    const throwing: AutoApprovalRules = {
      posts: {
        ...rules.posts!,
        scopes: [
          {
            scope: 'posts.routine',
            permits: () => {
              throw new Error('boom')
            },
          },
        ],
      },
    }
    expect(
      decideAutoApproval({ user: manager(['posts.routine']), change: change(), rules: throwing }),
    ).toEqual({ approve: false, reason: 'outside-every-scope' })
  })
})

describe('grantsOf / applicableScopes', () => {
  it('keeps only known scopes, once each', () => {
    expect(grantsOf(manager(['posts.routine', 'nope', 'posts.routine']))).toEqual(['posts.routine'])
  })

  it('a school manager’s scopes narrow to the ones the collection defines', () => {
    const user = manager(['posts.routine'])
    expect(applicableScopes(user, 'posts', rules)).toEqual(['posts.routine'])
    expect(applicableScopes(user, 'widgets', rules)).toEqual([])
    expect(applicableScopes(user, 'pages', rules)).toEqual([])
  })

  it('nobody but a school manager has applicable scopes', () => {
    expect(applicableScopes(districtAdmin as AuthUser, 'posts', rules)).toEqual([])
  })
})

describe('the real rule table', () => {
  it('pages have no scope: a page change is never auto-approved, even holding every grant', () => {
    const everything = manager(GRANT_SCOPES.map((s) => s.value))
    expect(AUTO_APPROVAL_RULES.pages?.scopes).toEqual([])
    expect(applicableScopes(everything, 'pages')).toEqual([])
    expect(
      decideAutoApproval({
        user: everything,
        change: change({ collection: 'pages', changedFields: ['title'] }),
      }),
    ).toEqual({ approve: false, reason: 'no-grant' })
  })

  it('page creation is never auto-approvable', () => {
    expect(AUTO_APPROVAL_RULES.pages?.createAllowed).toBe(false)
  })

  it('every rich-text, upload and block field on pages is a never field', () => {
    const contentTypes = new Set(['richText', 'upload', 'blocks'])
    const named = Pages.fields.filter(
      (f): f is typeof f & { name: string } => 'name' in f && contentTypes.has(f.type),
    )
    expect(named.length).toBeGreaterThan(0)
    for (const field of named) {
      expect(AUTO_APPROVAL_RULES.pages?.neverFields).toContain(field.name)
    }
  })

  it.each(['visibility', 'meta', 'parent'])(
    'the page field %s is a never field (`04` §4.3)',
    (name) => {
      expect(AUTO_APPROVAL_RULES.pages?.neverFields).toContain(name)
    },
  )

  it('the grant options are exactly the scopes the spec defines', () => {
    // `events.schedule` is gone: events skip approval altogether (Jason, 2026-11-11).
    expect(GRANT_SCOPES.map((s) => s.value)).toEqual(['posts.routine'])
  })
})

/**
 * `posts.routine` — the first scope that can act (Jason, 2026-10-28, option 1).
 *
 * A NARROW EXCEPTION to "never rich text": an announcement's own words may be auto-approved
 * under this grant. Everything else on the never list still queues — an upload, visibility,
 * sharing, the date, translation review — and rich text stays never-auto-approvable everywhere
 * else. A new announcement may be auto-approved; changing an existing one's address may not.
 */
describe('posts.routine', () => {
  const holder = manager(['posts.routine'])
  const post = (overrides: Partial<Change> = {}): Change =>
    change({ collection: 'posts', isCreate: true, changedFields: ['title', 'body'], ...overrides })

  it('a new announcement — headline, words, summary, board, tags — publishes under the grant', () => {
    expect(
      decideAutoApproval({
        user: holder,
        change: post({ changedFields: ['title', 'body', 'excerpt', 'board', 'tags', 'slug'] }),
      }),
    ).toEqual({ approve: true, scope: 'posts.routine' })
  })

  it('an edit to a live announcement’s words publishes under the grant', () => {
    expect(
      decideAutoApproval({
        user: holder,
        change: post({ isCreate: false, changedFields: ['body'] }),
      }),
    ).toEqual({ approve: true, scope: 'posts.routine' })
  })

  it.each(['visibility', 'syndication', 'publishedDate', 'requiresTranslationReview', 'heroImage'])(
    'a change to %s queues — the whole submission',
    (field) => {
      expect(
        decideAutoApproval({ user: holder, change: post({ changedFields: ['body', field] }) }),
      ).toEqual({ approve: false, reason: 'never-field' })
    },
  )

  it('moving a LIVE announcement to a new address queues; a new one’s address is its first', () => {
    expect(
      decideAutoApproval({
        user: holder,
        change: post({ isCreate: false, changedFields: ['title', 'slug'] }),
      }),
    ).toEqual({ approve: false, reason: 'outside-every-scope' })
  })

  it('an announcement flagged for translation review queues', () => {
    expect(
      decideAutoApproval({ user: holder, change: post({ requiresTranslationReview: true }) }),
    ).toEqual({ approve: false, reason: 'translation-review' })
  })

  it('without the grant — or with only a leftover events.schedule — it queues', () => {
    for (const user of [manager([]), manager(['events.schedule'])]) {
      expect(decideAutoApproval({ user, change: post() })).toEqual({
        approve: false,
        reason: 'no-grant',
      })
    }
  })

  it('the exception is the BODY only: every other rich-text or upload field on posts is never', () => {
    const contentTypes = new Set(['richText', 'upload', 'blocks'])
    const named = Posts.fields.filter(
      (f): f is typeof f & { name: string } =>
        'name' in f && contentTypes.has(f.type) && f.name !== 'body',
    )
    for (const field of named) {
      expect(AUTO_APPROVAL_RULES.posts?.neverFields).toContain(field.name)
    }
    expect(AUTO_APPROVAL_RULES.posts?.neverFields).not.toContain('body')
  })
})

/**
 * What a submission changed — what `decideAutoApproval` judges. Compared against the live
 * announcement, or, for one never published, against the defaults a new one starts with, so
 * "visibility unchanged" means "still public".
 */
describe('changedFields', () => {
  const FIELDS = ['title', 'body', 'board', 'tags', 'visibility', 'syndication']
  const live = {
    title: 'Picture day',
    body: { root: { children: [{ text: 'Thursday' }] } },
    board: 7,
    tags: [1, 2],
    visibility: 'public',
    syndication: { scope: 'this-tenant', syndicatedTo: [] },
  }

  it('nothing changed is nothing', () => {
    expect(changedFields(live, { ...live }, FIELDS)).toEqual([])
  })

  it('names each field whose value differs, in field order', () => {
    expect(
      changedFields(live, { ...live, visibility: 'staff', title: 'Picture day moved' }, FIELDS),
    ).toEqual(['title', 'visibility'])
  })

  it('a relationship populated on one side and an id on the other is the same', () => {
    expect(changedFields(live, { ...live, board: { id: 7, title: 'News' } }, FIELDS)).toEqual([])
  })

  it('tags ticked in another order are the same tags', () => {
    expect(changedFields(live, { ...live, tags: [{ id: 2 }, 1] }, FIELDS)).toEqual([])
  })

  it('a word changed in the body is a body change', () => {
    expect(
      changedFields(live, { ...live, body: { root: { children: [{ text: 'Friday' }] } } }, FIELDS),
    ).toEqual(['body'])
  })

  it('missing and empty read the same — a new post’s unset sharing is "this site"', () => {
    expect(
      changedFields(
        { visibility: 'public', syndication: { scope: 'this-tenant' } },
        { visibility: 'public', syndication: null },
        ['visibility', 'syndication'],
        NEW_POST_BASELINE,
      ),
    ).toEqual([])
  })
})
