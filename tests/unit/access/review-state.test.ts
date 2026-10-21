import { describe, expect, it } from 'vitest'

import { resolveReview, type ReviewFields } from '@/access/review-state'
import type { AuthUser } from '@/access/types'

/**
 * The review-state machine (`04` §4.1).
 *
 * `editing` | `submitted` | `changes-requested`, and `null` for "nothing pending". Built on
 * Payload drafts — this decides only who may move a page between states, and what the four
 * review fields hold afterwards. Publishing itself is the publish gate's (`publish-gate.ts`);
 * this file is told whether the write publishes and never decides it.
 *
 * Test-first per CLAUDE.md: the publish gate and the approval boundary are mandatory TDD.
 */

const districtAdmin: AuthUser = { id: 'd1', roles: ['district-admin'], tenants: [] }
const managerA: AuthUser = { id: 'm1', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
const systemSync: AuthUser = { id: 's1', roles: ['system-sync'], tenants: [{ tenant: 'A' }] }

const NOW = '2026-10-21T15:00:00.000Z'
const EARLIER = '2026-10-19T09:00:00.000Z'

const nothingPending: ReviewFields = {
  reviewState: null,
  reviewNote: null,
  submittedAt: null,
  submittedBy: null,
}
const editing: ReviewFields = { ...nothingPending, reviewState: 'editing' }
const submitted: ReviewFields = {
  reviewState: 'submitted',
  reviewNote: null,
  submittedAt: EARLIER,
  submittedBy: 'm1',
}
const changesRequested: ReviewFields = {
  ...submitted,
  reviewState: 'changes-requested',
  reviewNote: 'The bus times are last year’s.',
}

type Input = Parameters<typeof resolveReview>[0]
const run = (input: Partial<Input> & Pick<Input, 'user'>) =>
  resolveReview({ current: null, publishing: false, now: NOW, ...input })

const fieldsOf = (result: ReturnType<typeof resolveReview>) => {
  if (!result.ok) throw new Error(`expected ok, got refusal: ${result.reason}`)
  return result.fields
}

describe('resolveReview — school-manager', () => {
  /**
   * The one button (`04` §2.3). A create that is also a submit is the normal school path —
   * the form has no separate save.
   */
  it.each([
    ['nothing pending', null],
    ['nothing pending (existing page)', nothingPending],
    ['editing', editing],
    ['changes requested', changesRequested],
  ])('sends for approval from %s, stamping who and when', (_, current) => {
    const fields = fieldsOf(run({ user: managerA, current, requested: 'submitted' }))
    expect(fields).toEqual({
      reviewState: 'submitted',
      reviewNote: null,
      submittedAt: NOW,
      submittedBy: 'm1',
    })
  })

  /**
   * A resubmit of something already queued keeps its age. Resetting `submittedAt` would let
   * an edit push an old item to the back of the escalation clock (`04` §5).
   */
  it('keeps the original submission time when sending again', () => {
    const fields = fieldsOf(run({ user: managerA, current: submitted, requested: 'submitted' }))
    expect(fields).toMatchObject({ reviewState: 'submitted', submittedAt: EARLIER })
  })

  it('an unsubmitted save is editing', () => {
    expect(fieldsOf(run({ user: managerA, current: null })).reviewState).toBe('editing')
    expect(fieldsOf(run({ user: managerA, current: editing })).reviewState).toBe('editing')
  })

  /**
   * A save on a queued page keeps it queued, with the newer content. Payload merges the stored
   * document into the write before this runs, so "sent `submitted` again" and "did not
   * mention it" are the same input — a rule that told them apart could not be enforced.
   *
   * The race that leaves open — the district approving content that changed after they
   * looked — is closed where approval happens: approve publishes the version the reviewer
   * saw (the queue, `04` §4.2), which also covers a resubmit mid-review.
   */
  it.each([
    ['not sent', undefined],
    ['sent unchanged', 'submitted'],
  ] as const)('a save on a queued page, state %s, keeps it queued', (_, requested) => {
    expect(fieldsOf(run({ user: managerA, current: submitted, requested }))).toEqual(submitted)
  })

  /** The note stays at the top of the item until the school answers it by resubmitting. */
  it('an unsubmitted save keeps changes-requested, and the note with it', () => {
    const fields = fieldsOf(run({ user: managerA, current: changesRequested }))
    expect(fields).toEqual(changesRequested)
  })

  it.each([
    ['request changes', 'changes-requested'],
    ['clear the state', null],
  ] as const)('may not %s', (_, requested) => {
    const result = run({ user: managerA, current: submitted, requested })
    expect(result.ok).toBe(false)
  })

  /** A school cannot forge the reviewer's voice or the submitter's identity. */
  it('ignores a note or submitter it sends', () => {
    const fields = fieldsOf(
      run({
        user: managerA,
        current: editing,
        requested: 'submitted',
        note: 'Approved by the district',
      }),
    )
    expect(fields.reviewNote).toBeNull()
    expect(fields.submittedBy).toBe('m1')
  })

  /** The publish gate refuses this first; refused here too rather than trusted. */
  it('may not publish', () => {
    expect(run({ user: managerA, current: submitted, publishing: true }).ok).toBe(false)
  })
})

describe('resolveReview — district-admin', () => {
  /** Approve IS publish (`04` §4.1): the pending change goes live and the state clears. */
  it.each([
    ['submitted', submitted],
    ['changes requested', changesRequested],
    ['editing', editing],
    ['nothing pending', nothingPending],
    ['a new page', null],
  ])('publishing clears every review field (from %s)', (_, current) => {
    expect(fieldsOf(run({ user: districtAdmin, current, publishing: true }))).toEqual(
      nothingPending,
    )
  })

  it('requests changes on a submission, with a note', () => {
    const fields = fieldsOf(
      run({
        user: districtAdmin,
        current: submitted,
        requested: 'changes-requested',
        note: '  The bus times are last year’s.  ',
      }),
    )
    expect(fields).toEqual({
      reviewState: 'changes-requested',
      reviewNote: 'The bus times are last year’s.',
      // Kept: the submitter is who the notification goes to (`04` §4.5).
      submittedAt: EARLIER,
      submittedBy: 'm1',
    })
  })

  /** `04` §4.4 — "Request changes" requires a note. */
  it.each([[undefined], [null], [''], ['   ']])(
    'refuses a request for changes with note %j',
    (note) => {
      const result = run({
        user: districtAdmin,
        current: submitted,
        requested: 'changes-requested',
        note,
      })
      expect(result).toMatchObject({ ok: false, field: 'reviewNote' })
    },
  )

  it.each([
    ['nothing pending', null],
    ['editing', editing],
  ])('refuses to request changes on %s — there is no submission to answer', (_, current) => {
    const result = run({
      user: districtAdmin,
      current,
      requested: 'changes-requested',
      note: 'Fix it',
    })
    expect(result.ok).toBe(false)
  })

  /**
   * The district's own unpublished edits leave the review fields alone. Payload's admin sends
   * every field on save, so "requested equals current" must read as "not asked to change".
   */
  it.each([
    ['not sent', undefined],
    ['sent unchanged', 'submitted'],
  ] as const)('a draft save with the state %s leaves a submission queued', (_, requested) => {
    expect(fieldsOf(run({ user: districtAdmin, current: submitted, requested }))).toEqual(submitted)
  })

  /** Already sent back: the admin re-sends the state on save, and nothing moves. */
  it('a draft save on a page already sent back leaves it, and its note, alone', () => {
    expect(
      fieldsOf(
        run({
          user: districtAdmin,
          current: changesRequested,
          requested: 'changes-requested',
          note: 'A different note',
        }),
      ),
    ).toEqual(changesRequested)
  })

  /** The district publishes directly; it never queues work for itself. */
  it('may not send for approval', () => {
    expect(run({ user: districtAdmin, current: editing, requested: 'submitted' }).ok).toBe(false)
  })
})

describe('resolveReview — everyone else', () => {
  /** A real actor with no business in page review — refused, not ignored. */
  it('system-sync is refused outright', () => {
    expect(run({ user: systemSync, current: editing, requested: 'submitted' }).ok).toBe(false)
    expect(run({ user: systemSync, current: editing }).ok).toBe(false)
    expect(run({ user: systemSync, current: editing, publishing: true }).ok).toBe(false)
  })

  /**
   * No user reaches here only with access overridden — trusted server code (the seed, the
   * Phase 9 import). An anonymous API write is refused by the access functions before any
   * hook runs. Such a write passes, and moves nothing.
   */
  it('a write with no user leaves review exactly as stored', () => {
    expect(
      fieldsOf(run({ user: null, current: submitted, requested: 'changes-requested' })),
    ).toEqual(submitted)
    expect(fieldsOf(run({ user: null, current: null }))).toEqual(nothingPending)
  })
})

describe('resolveReview — an unknown stored state', () => {
  /**
   * A value outside the three — a migration bug, a renamed state — reads as nothing pending
   * rather than throwing. Failing closed here would lock every school out of a page.
   */
  it('reads as nothing pending', () => {
    const fields = fieldsOf(
      run({
        user: managerA,
        current: { ...nothingPending, reviewState: 'approved' as never },
        requested: 'submitted',
      }),
    )
    expect(fields.reviewState).toBe('submitted')
  })
})
