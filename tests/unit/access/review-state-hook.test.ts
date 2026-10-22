import { Forbidden, ValidationError } from 'payload'
import { describe, expect, it } from 'vitest'

import type { AuthUser } from '@/access/types'
import { applyReviewState } from '@/collections/hooks/review-state'

/**
 * The hook that applies `resolveReview` to a `pages` write (`04` §4.1).
 *
 * The transitions themselves are `review-state.test.ts`. This pins the adapter: what it reads
 * from the write, what it writes back, and which error each refusal becomes.
 */

const districtAdmin: AuthUser = { id: 'd1', roles: ['district-admin'], tenants: [] }
const managerA: AuthUser = { id: 'm1', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
const numericManager: AuthUser = { id: 12, roles: ['school-manager'], tenants: [{ tenant: 'A' }] }

const hookArgs = (
  user: AuthUser | null,
  data: Record<string, unknown>,
  originalDoc?: Record<string, unknown>,
  operation: 'create' | 'update' = 'update',
) => ({ req: { user }, data, originalDoc, operation }) as never

const submittedDoc = {
  reviewState: 'submitted',
  reviewNote: null,
  submittedAt: '2026-10-19T09:00:00.000Z',
  submittedBy: 7,
}

describe('applyReviewState', () => {
  it('writes the resolved fields over the incoming data, keeping everything else', () => {
    const result = applyReviewState(
      hookArgs(managerA, { title: 'Bus routes', reviewState: 'submitted' }, undefined, 'create'),
    ) as Record<string, unknown>

    expect(result).toMatchObject({
      title: 'Bus routes',
      reviewState: 'submitted',
      reviewNote: null,
      submittedBy: 'm1',
    })
    expect(typeof result.submittedAt).toBe('string')
  })

  it('writes the submitting user’s id in its own form', () => {
    const result = applyReviewState(
      hookArgs(numericManager, { reviewState: 'submitted' }, { reviewState: 'editing' }),
    ) as Record<string, unknown>
    expect(result.submittedBy).toBe(12)
  })

  it('overwrites a forged note and submitter rather than trusting them', () => {
    const result = applyReviewState(
      hookArgs(
        managerA,
        { reviewState: 'submitted', reviewNote: 'Approved', submittedBy: 'd1' },
        { reviewState: 'editing' },
      ),
    ) as Record<string, unknown>
    expect(result).toMatchObject({ reviewNote: null, submittedBy: 'm1' })
  })

  /**
   * Payload stores the relationship as the users' serial id. The machine compares strings;
   * what goes back to the database is the id as it was stored, populated or not.
   */
  it('keeps a stored submitter in its stored form across a save', () => {
    const plain = applyReviewState(hookArgs(districtAdmin, { title: 'x' }, submittedDoc)) as Record<
      string,
      unknown
    >
    expect(plain.submittedBy).toBe(7)

    const populated = applyReviewState(
      hookArgs(districtAdmin, { title: 'x' }, { ...submittedDoc, submittedBy: { id: 7 } }),
    ) as Record<string, unknown>
    expect(populated.submittedBy).toBe(7)
  })

  it('reads _status: published as the publishing write, and clears the review', () => {
    const result = applyReviewState(
      hookArgs(districtAdmin, { _status: 'published' }, submittedDoc),
    ) as Record<string, unknown>
    expect(result).toMatchObject({ reviewState: null, submittedBy: null, submittedAt: null })
  })

  it('a missing note becomes a ValidationError on reviewNote — a form error, not a 403', () => {
    expect(() =>
      applyReviewState(hookArgs(districtAdmin, { reviewState: 'changes-requested' }, submittedDoc)),
    ).toThrow(ValidationError)
  })

  it('a transition the user may not make is Forbidden', () => {
    expect(() =>
      applyReviewState(hookArgs(managerA, { reviewState: 'changes-requested' }, submittedDoc)),
    ).toThrow(Forbidden)
  })

  it('a write with no user (access overridden) keeps the stored review', () => {
    const result = applyReviewState(
      hookArgs(null, { title: 'x', reviewState: 'changes-requested' }, submittedDoc),
    ) as Record<string, unknown>
    expect(result).toMatchObject({ reviewState: 'submitted', submittedBy: 7 })
  })
})
