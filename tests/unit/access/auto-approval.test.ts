import { describe, expect, it } from 'vitest'

import {
  AUTO_APPROVAL_RULES,
  GRANT_SCOPES,
  applicableScopes,
  decideAutoApproval,
  grantsOf,
  type AutoApprovalRules,
  type Change,
} from '@/access/auto-approval'
import type { AuthUser } from '@/access/types'
import { Pages } from '@/collections/Pages'

/**
 * The auto-approval grant boundary (`04` §4.3) — one of the five 100%-intent areas in `06` §7.
 *
 * NOTHING AUTO-APPROVES WITHOUT AN EXPLICIT GRANT on the person sending it. A grant is never
 * implied by role, school or content type, and a submission that mixes a permitted change with
 * anything else queues in full.
 *
 * The scopes the spec defines (`events:schedule`, `posts:routine`) belong to collections that
 * arrive in Phase 5, so the framework is proven here against a synthetic rule table. The real
 * table is checked separately: today it gives `pages` no scope at all.
 */

const manager = (autoApprove: unknown = []): AuthUser =>
  ({
    id: 'm1',
    roles: ['school-manager'],
    tenants: [{ tenant: 'A' }],
    autoApprove,
  }) as AuthUser

const districtAdmin = { id: 'd1', roles: ['district-admin'], autoApprove: ['posts:routine'] }
const sync = { id: 's1', roles: ['system-sync'], autoApprove: ['posts:routine'] }

/** A stand-in for Phase 5's collections — field names are the spec's, not a schema. */
const rules: AutoApprovalRules = {
  events: {
    neverFields: ['agendaBody', 'image', 'visibility'],
    createAllowed: true,
    scopes: [
      {
        scope: 'events:schedule',
        permits: ({ changedFields }) =>
          changedFields.every((f) => ['title', 'start', 'end', 'location'].includes(f)),
      },
    ],
  },
  posts: {
    neverFields: ['body', 'image', 'meta', 'syndicateTo'],
    createAllowed: true,
    scopes: [{ scope: 'posts:routine', permits: () => true }],
  },
}

const change = (overrides: Partial<Change> = {}): Change => ({
  collection: 'events',
  isCreate: false,
  changedFields: ['start', 'end'],
  requiresTranslationReview: false,
  ...overrides,
})

const decide = (user: AuthUser | null, c: Change = change()) =>
  decideAutoApproval({ user, change: c, rules })

describe('decideAutoApproval — the grant boundary', () => {
  it('a manager holding the matching grant, making only that change, is auto-approved', () => {
    expect(decide(manager(['events:schedule']))).toEqual({
      approve: true,
      scope: 'events:schedule',
    })
  })

  it('with NO grants issued, every submission queues, for every collection', () => {
    for (const collection of ['events', 'posts', 'pages']) {
      expect(decide(manager([]), change({ collection }))).toEqual({
        approve: false,
        reason: 'no-grant',
      })
    }
  })

  it.each([
    ['a missing field', undefined],
    ['null', null],
    ['a string, not a list', 'events:schedule'],
    ['an unknown scope', ['events:everything']],
    ['a near miss', ['Events:Schedule']],
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
    expect(decide(manager(['posts:routine']))).toEqual({
      approve: false,
      reason: 'no-grant',
    })
  })

  it('a collection with no rules at all queues', () => {
    expect(decide(manager(['events:schedule']), change({ collection: 'documents' }))).toEqual({
      approve: false,
      reason: 'no-grant',
    })
  })

  it('a MIXED submission queues in full — no partial approval', () => {
    expect(
      decide(manager(['events:schedule']), change({ changedFields: ['start', 'description'] })),
    ).toEqual({ approve: false, reason: 'outside-every-scope' })
  })

  it('a never-auto-approvable field queues even when a scope would permit everything', () => {
    expect(
      decide(manager(['posts:routine']), change({ collection: 'posts', changedFields: ['body'] })),
    ).toEqual({ approve: false, reason: 'never-field' })
  })

  it('one never field among permitted ones still queues the whole submission', () => {
    expect(
      decide(manager(['events:schedule']), change({ changedFields: ['start', 'agendaBody'] })),
    ).toEqual({ approve: false, reason: 'never-field' })
  })

  it('anything on a page flagged for translation review queues', () => {
    expect(
      decide(manager(['events:schedule']), change({ requiresTranslationReview: true })),
    ).toEqual({ approve: false, reason: 'translation-review' })
  })

  it('a create queues where the collection does not allow auto-approved creation', () => {
    const noCreate: AutoApprovalRules = { events: { ...rules.events!, createAllowed: false } }
    expect(
      decideAutoApproval({
        user: manager(['events:schedule']),
        change: change({ isCreate: true }),
        rules: noCreate,
      }),
    ).toEqual({ approve: false, reason: 'new-document' })
  })

  it('a send with nothing changed queues — there is nothing for a grant to cover', () => {
    expect(decide(manager(['events:schedule']), change({ changedFields: [] }))).toEqual({
      approve: false,
      reason: 'nothing-changed',
    })
  })

  it('a rule that throws queues rather than approving', () => {
    const throwing: AutoApprovalRules = {
      events: {
        ...rules.events!,
        scopes: [
          {
            scope: 'events:schedule',
            permits: () => {
              throw new Error('boom')
            },
          },
        ],
      },
    }
    expect(
      decideAutoApproval({ user: manager(['events:schedule']), change: change(), rules: throwing }),
    ).toEqual({ approve: false, reason: 'outside-every-scope' })
  })
})

describe('grantsOf / applicableScopes', () => {
  it('keeps only known scopes, once each', () => {
    expect(grantsOf(manager(['posts:routine', 'nope', 'posts:routine']))).toEqual(['posts:routine'])
  })

  it('a school manager’s scopes narrow to the ones the collection defines', () => {
    const user = manager(['events:schedule', 'posts:routine'])
    expect(applicableScopes(user, 'events', rules)).toEqual(['events:schedule'])
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

  it.each(['visibility', 'meta', 'pageType', 'parent'])(
    'the page field %s is a never field (`04` §4.3)',
    (name) => {
      expect(AUTO_APPROVAL_RULES.pages?.neverFields).toContain(name)
    },
  )

  it('the grant options are exactly the scopes the spec defines', () => {
    expect(GRANT_SCOPES.map((s) => s.value)).toEqual(['events:schedule', 'posts:routine'])
  })
})
