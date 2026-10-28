import { describe, expect, it } from 'vitest'

import { auditEntries, type AuditInput } from '@/lib/audit'

/**
 * Which audit entries a write produces (`04` §8, `03` §7, `09` §6).
 *
 * "Invisible approval, never invisible change" (`04` §4.3): every approval-path action, and
 * every change to who may do what, leaves an entry naming who, which school, when and what.
 * Ordinary edits do not — Payload's versions already hold them.
 */

const manager = { id: 5, email: 'm@dd2.org', roles: ['school-manager'] }
const district = { id: 3, email: 'd@dd2.org', roles: ['district-admin'] }

const page = (overrides: Record<string, unknown> = {}) => ({
  id: 41,
  title: 'Bus routes',
  tenant: 7,
  _status: 'draft',
  reviewState: null,
  reviewNote: null,
  ...overrides,
})

const pages = (overrides: Partial<AuditInput>): AuditInput => ({
  collection: 'pages',
  operation: 'update',
  previous: page(),
  doc: page(),
  user: manager,
  ...overrides,
})

describe('pages', () => {
  it('a school sending a page records a submit, by them, for their school', () => {
    expect(auditEntries(pages({ doc: page({ reviewState: 'submitted' }) }))).toEqual([
      {
        action: 'submit',
        contentType: 'pages',
        documentId: '41',
        documentTitle: 'Bus routes',
        tenant: '7',
        actor: '5',
        actorLabel: 'm@dd2.org',
        summary: '',
        autoApproved: false,
      },
    ])
  })

  it('a page created and sent in one write is a submit', () => {
    expect(
      auditEntries(
        pages({ operation: 'create', previous: null, doc: page({ reviewState: 'submitted' }) }),
      ).map((e) => e.action),
    ).toEqual(['submit'])
  })

  it('resending after changes were requested is another submit', () => {
    expect(
      auditEntries(
        pages({
          previous: page({ reviewState: 'changes-requested' }),
          doc: page({ reviewState: 'submitted' }),
        }),
      ).map((e) => e.action),
    ).toEqual(['submit'])
  })

  it('a save on a page already waiting records nothing — it is an edit', () => {
    expect(
      auditEntries(
        pages({
          previous: page({ reviewState: 'submitted' }),
          doc: page({ reviewState: 'submitted', title: 'Bus routes (v2)' }),
        }),
      ),
    ).toEqual([])
  })

  it('an ordinary edit records nothing', () => {
    expect(auditEntries(pages({ doc: page({ reviewState: 'editing', title: 'New' }) }))).toEqual([])
  })

  it('the district sending it back records request-changes, with the note', () => {
    const [entry] = auditEntries(
      pages({
        user: district,
        previous: page({ reviewState: 'submitted' }),
        doc: page({ reviewState: 'changes-requested', reviewNote: 'Route 4 moved.' }),
      }),
    )
    expect(entry).toMatchObject({
      action: 'request-changes',
      actor: '3',
      summary: 'Route 4 moved.',
    })
  })

  it('publishing a page that was waiting is an approve', () => {
    expect(
      auditEntries(
        pages({
          user: district,
          previous: page({ reviewState: 'submitted' }),
          doc: page({ _status: 'published' }),
        }),
      ).map((e) => e.action),
    ).toEqual(['approve'])
  })

  it('publishing a page nobody sent is a publish', () => {
    expect(
      auditEntries(pages({ user: district, doc: page({ _status: 'published' }) })).map(
        (e) => e.action,
      ),
    ).toEqual(['publish'])
  })

  it('a publishing write by trusted server code is recorded, as the system', () => {
    expect(
      auditEntries(
        pages({
          user: null,
          operation: 'create',
          previous: null,
          doc: page({ _status: 'published' }),
        }),
      ),
    ).toEqual([expect.objectContaining({ action: 'publish', actor: null, actorLabel: 'System' })])
  })

  it('restoring a past version is a restore, whatever it restores to', () => {
    expect(
      auditEntries(
        pages({ user: district, restoring: true, doc: page({ _status: 'published' }) }),
      ).map((e) => e.action),
    ).toEqual(['restore'])
  })

  it('deleting a page is a delete', () => {
    expect(
      auditEntries(pages({ user: district, operation: 'delete', doc: page() })).map(
        (e) => e.action,
      ),
    ).toEqual(['delete'])
  })

  it('an untitled page is named by its id', () => {
    const [entry] = auditEntries(pages({ doc: page({ title: '', reviewState: 'submitted' }) }))
    expect(entry!.documentTitle).toBe('Page 41')
  })

  it('reads a populated tenant', () => {
    const [entry] = auditEntries(
      pages({ doc: page({ tenant: { id: 7, name: 'A' }, reviewState: 'submitted' }) }),
    )
    expect(entry!.tenant).toBe('7')
  })
})

/**
 * Posts move through review exactly as pages do (`04` §4.1), so they record the same actions.
 * Asserted per action rather than by "same as pages", so a posts-only regression names itself.
 */
describe('posts', () => {
  const posts = (overrides: Partial<AuditInput>): AuditInput => ({
    ...pages(overrides),
    collection: 'posts',
  })

  it('a school sending a post records a submit, as a post, for their school', () => {
    const [entry] = auditEntries(posts({ doc: page({ reviewState: 'submitted' }) }))
    expect(entry).toMatchObject({
      action: 'submit',
      contentType: 'posts',
      documentId: '41',
      documentTitle: 'Bus routes',
      tenant: '7',
      actor: '5',
    })
  })

  it.each([
    ['approve', { reviewState: 'submitted' }, { _status: 'published' }],
    ['publish', {}, { _status: 'published' }],
    ['request-changes', { reviewState: 'submitted' }, { reviewState: 'changes-requested' }],
  ])('records %s', (action, before, after) => {
    const entries = auditEntries(
      posts({ user: district, previous: page(before), doc: page({ ...before, ...after }) }),
    )
    expect(entries.map((e) => e.action)).toEqual([action])
  })

  it('records a restore and a delete', () => {
    expect(auditEntries(posts({ restoring: true })).map((e) => e.action)).toEqual(['restore'])
    expect(auditEntries(posts({ operation: 'delete' })).map((e) => e.action)).toEqual(['delete'])
  })

  it('an ordinary edit records nothing', () => {
    expect(auditEntries(posts({ doc: page({ reviewState: 'editing', title: 'New' }) }))).toEqual([])
  })

  it('an untitled post is named as a post', () => {
    const [entry] = auditEntries(posts({ doc: page({ title: '', reviewState: 'submitted' }) }))
    expect(entry!.documentTitle).toBe('Post 41')
  })
})

const person = (overrides: Record<string, unknown> = {}) => ({
  id: 9,
  email: 'x@dd2.org',
  name: 'Ana Ruiz',
  roles: ['school-manager'],
  tenants: [{ tenant: 7 }],
  autoApprove: [],
  receivesAlerts: true,
  ...overrides,
})

const users = (overrides: Partial<AuditInput>): AuditInput => ({
  collection: 'users',
  operation: 'update',
  previous: person(),
  doc: person(),
  user: district,
  ...overrides,
})

describe('users', () => {
  it('creating a user records who, with what roles', () => {
    const [entry] = auditEntries(users({ operation: 'create', previous: null }))
    expect(entry).toMatchObject({
      action: 'user-create',
      contentType: 'users',
      documentId: '9',
      documentTitle: 'Ana Ruiz',
      tenant: null,
      actor: '3',
      summary: 'Roles: school-manager',
    })
  })

  it('a grant change is its own entry, before and after in words', () => {
    expect(auditEntries(users({ doc: person({ autoApprove: ['posts.routine'] }) }))).toEqual([
      expect.objectContaining({
        action: 'grant-change',
        summary: 'Auto-approval: none → Posts: routine posts',
      }),
    ])
  })

  it('a role, school or alert change is a user-change naming what changed', () => {
    const [entry] = auditEntries(
      users({
        doc: person({ roles: ['district-admin'], tenants: [{ tenant: 8 }], receivesAlerts: false }),
      }),
    )
    expect(entry).toMatchObject({ action: 'user-change' })
    expect(entry!.summary).toBe(
      'Roles: school-manager → district-admin; Schools changed; Alert emails: on → off',
    )
  })

  it('a grant and a role changed together make two entries', () => {
    expect(
      auditEntries(
        users({ doc: person({ roles: ['district-admin'], autoApprove: ['events.schedule'] }) }),
      ).map((e) => e.action),
    ).toEqual(['user-change', 'grant-change'])
  })

  it('a login, a password change or any other bookkeeping records nothing', () => {
    expect(
      auditEntries(
        users({
          previous: person({ lastLoginAt: null, loginAttempts: 0, hash: 'a', salt: 'b' }),
          doc: person({ lastLoginAt: '2026-10-27', loginAttempts: 1, hash: 'c', salt: 'd' }),
        }),
      ),
    ).toEqual([])
  })

  it('never writes a password, hash or token into a summary', () => {
    const entries = auditEntries(
      users({
        operation: 'create',
        previous: null,
        doc: person({ password: 'p', hash: 'h', salt: 's', resetPasswordToken: 't' }),
      }),
    )
    expect(JSON.stringify(entries)).not.toMatch(/"p"|"h"|"s"|"t"|hash|salt|token|password/i)
  })

  it('a successful sign-in is a login, by the person signing in', () => {
    expect(
      auditEntries({
        collection: 'users',
        operation: 'login',
        previous: null,
        doc: person(),
        user: person(),
      }),
    ).toEqual([
      expect.objectContaining({
        action: 'login',
        contentType: 'users',
        documentId: '9',
        documentTitle: 'Ana Ruiz',
        tenant: null,
        actor: '9',
        actorLabel: 'x@dd2.org',
        summary: '',
      }),
    ])
  })

  it('a login entry names the user even when the request carries no user yet', () => {
    const [entry] = auditEntries({
      collection: 'users',
      operation: 'login',
      previous: null,
      doc: person(),
      user: null,
    })
    expect(entry).toMatchObject({ action: 'login', actor: '9', actorLabel: 'x@dd2.org' })
  })

  it('deleting a user is a user-delete', () => {
    expect(auditEntries(users({ operation: 'delete' })).map((e) => e.action)).toEqual([
      'user-delete',
    ])
  })

  it('a user with no name is named by their email', () => {
    const [entry] = auditEntries(
      users({ operation: 'create', previous: null, doc: person({ name: null }) }),
    )
    expect(entry!.documentTitle).toBe('x@dd2.org')
  })
})

describe('anything else', () => {
  it('a collection the trail does not cover records nothing', () => {
    expect(auditEntries({ ...pages({}), collection: 'theme' })).toEqual([])
  })
})
