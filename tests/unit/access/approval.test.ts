import { describe, expect, it } from 'vitest'

import { checkApproval, type VersionToken } from '@/access/approval'
import type { AuthUser } from '@/access/types'

/**
 * Approving the version the reviewer SAW (`04` §4.1–4.2).
 *
 * A save on a queued page keeps it queued (`review-state.ts`), so a school can change a page
 * after the district opened the queue. Approving "the latest draft" would publish words no
 * reviewer read. The queue therefore sends back a token for what it rendered, and approve
 * succeeds only while that is still the latest version.
 *
 * THE TOKEN IS ID **AND** TIMESTAMP. Payload's autosave rewrites the latest autosave version IN
 * PLACE — same id, new content — so the id alone would let a changed page through.
 *
 * Test-first per CLAUDE.md: the approval boundary is mandatory TDD.
 */

const districtAdmin: AuthUser = { id: 'd1', roles: ['district-admin'] }
const manager: AuthUser = { id: 'm1', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
const sync: AuthUser = { id: 's1', roles: ['system-sync'] }

const seen: VersionToken = { versionId: '41', updatedAt: '2026-10-22T14:00:00.000Z' }

const base = { user: districtAdmin, reviewState: 'submitted', seen, latest: seen }

describe('checkApproval', () => {
  it('a district admin approves the version they saw while it is still the latest', () => {
    expect(checkApproval(base)).toEqual({ ok: true })
  })

  it('compares ids as strings — Postgres ids arrive as numbers, form bodies as strings', () => {
    expect(
      checkApproval({
        ...base,
        latest: { versionId: 41 as unknown as string, updatedAt: seen.updatedAt },
      }),
    ).toEqual({ ok: true })
  })

  it.each([
    ['a school manager', manager],
    ['the sync account', sync],
    ['no user', null],
    ['a user with no roles', { id: 'x', roles: [] } as AuthUser],
  ])('%s cannot approve', (_label, user) => {
    expect(checkApproval({ ...base, user })).toEqual({ ok: false, reason: 'forbidden' })
  })

  it.each([null, 'editing', 'changes-requested', 'approved'])(
    'a page in state %s is not waiting, so there is nothing to approve',
    (reviewState) => {
      expect(checkApproval({ ...base, reviewState })).toEqual({ ok: false, reason: 'not-waiting' })
    },
  )

  it('a newer version than the one seen is refused', () => {
    expect(
      checkApproval({
        ...base,
        latest: { versionId: '42', updatedAt: '2026-10-22T14:05:00.000Z' },
      }),
    ).toEqual({ ok: false, reason: 'changed' })
  })

  it('the SAME version rewritten by autosave is refused', () => {
    expect(
      checkApproval({
        ...base,
        latest: { versionId: '41', updatedAt: '2026-10-22T14:03:00.000Z' },
      }),
    ).toEqual({ ok: false, reason: 'changed' })
  })

  it('timestamps that are the same instant in different spellings match', () => {
    expect(
      checkApproval({ ...base, latest: { versionId: '41', updatedAt: '2026-10-22T14:00:00Z' } }),
    ).toEqual({ ok: true })
  })

  it.each([
    ['no token', undefined],
    ['an empty id', { versionId: '', updatedAt: seen.updatedAt }],
    ['an unparseable time', { versionId: '41', updatedAt: 'yesterday' }],
  ])('%s is refused as changed — never approved blind', (_label, token) => {
    expect(checkApproval({ ...base, seen: token as VersionToken | undefined })).toEqual({
      ok: false,
      reason: 'changed',
    })
  })

  it('no stored version at all is refused as changed', () => {
    expect(checkApproval({ ...base, latest: null })).toEqual({ ok: false, reason: 'changed' })
  })

  it('the role is checked before anything else', () => {
    expect(
      checkApproval({ user: manager, reviewState: null, seen: undefined, latest: null }),
    ).toEqual({ ok: false, reason: 'forbidden' })
  })
})
