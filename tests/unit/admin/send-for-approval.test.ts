import { describe, expect, it } from 'vitest'

import {
  describeReview,
  NEEDS_WORDS,
  publishControlFor,
  sendRefusal,
  sendsForApproval,
} from '@/admin/SendForApproval/review-status'
import type { AuthUser } from '@/access/types'

/**
 * The school plane's document controls (`04` §2.3).
 *
 * Two pure decisions sit under the "Send for approval" button: WHO gets it in place of
 * Payload's draft/publish controls, and WHAT the status line says instead of "Draft" /
 * "Published" — a distinction `04` §2.1 rules out showing to a school manager at all.
 *
 * The component around them is a custom admin view, which CLAUDE.md's TDD exception table
 * locks with a Playwright flow and an axe assertion instead (`tests/e2e/send-for-approval.spec.ts`).
 */

const districtAdmin: AuthUser = { id: 'd1', roles: ['district-admin'] }
const manager: AuthUser = { id: 'm1', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
const both: AuthUser = { id: 'b1', roles: ['district-admin', 'school-manager'] }
const sync: AuthUser = { id: 's1', roles: ['system-sync'] }

describe('sendsForApproval — who gets the one button', () => {
  it.each<[string, AuthUser | null | undefined, boolean]>([
    ['a school manager', manager, true],
    ['a district admin', districtAdmin, false],
    // Roles are flat (`03` §6.1); holding district-admin means the user CAN publish, and
    // hiding a working Publish behind "Send for approval" would queue their own change to them.
    ['a user holding both roles', both, false],
    // Not a person, and never in the admin — but if it were, it would get Payload's controls,
    // which its access functions already refuse.
    ['the sync account', sync, false],
    ['a user with no roles', { id: 'x', roles: [] }, false],
    ['a user with null roles', { id: 'x', roles: null }, false],
    ['no user', null, false],
    ['an undefined user', undefined, false],
  ])('%s → %s', (_label, user, expected) => {
    expect(sendsForApproval(user)).toBe(expected)
  })
})

describe('describeReview — the status line in place of Draft / Published', () => {
  const TZ = 'America/New_York'

  it('nothing pending says changes save themselves and how to send them', () => {
    const status = describeReview({ reviewState: null }, TZ)
    expect(status.tone).toBe('idle')
    expect(status.heading).toBe('Your changes save automatically')
    expect(status.detail).toBe('When you are ready, send them for approval.')
  })

  it('"editing" reads the same as nothing pending — the difference is not the user\'s concern', () => {
    expect(describeReview({ reviewState: 'editing' }, TZ)).toEqual(
      describeReview({ reviewState: null }, TZ),
    )
  })

  it('submitted names the day it was sent, in the district time zone', () => {
    // 03:30 UTC on the 22nd is still the evening of the 21st in South Carolina.
    const status = describeReview(
      { reviewState: 'submitted', submittedAt: '2026-10-22T03:30:00.000Z' },
      TZ,
    )
    expect(status.tone).toBe('waiting')
    expect(status.heading).toBe('Sent for approval on October 21')
    expect(status.detail).toBe('The district will review it before it goes live.')
  })

  it('submitted without a date still says it was sent', () => {
    const status = describeReview({ reviewState: 'submitted', submittedAt: null }, TZ)
    expect(status.heading).toBe('Sent for approval')
  })

  it('submitted with an unparseable date falls back rather than printing "Invalid Date"', () => {
    const status = describeReview({ reviewState: 'submitted', submittedAt: 'not a date' }, TZ)
    expect(status.heading).toBe('Sent for approval')
  })

  it("changes requested carries the reviewer's note, trimmed, and what to do next", () => {
    const status = describeReview(
      { reviewState: 'changes-requested', reviewNote: '  The bus times are last year’s.  ' },
      TZ,
    )
    expect(status.tone).toBe('action')
    expect(status.heading).toBe('The district asked for changes')
    expect(status.note).toBe('The bus times are last year’s.')
    expect(status.detail).toBe('Make the changes, then send it for approval again.')
  })

  it('changes requested with no note omits it rather than showing an empty quote', () => {
    // The hook refuses an empty note (`review-state.ts`), but this renders stored data and
    // must not trust that every row was written through it.
    const status = describeReview({ reviewState: 'changes-requested', reviewNote: '   ' }, TZ)
    expect(status.note).toBeUndefined()
  })

  it('only changes requested carries a note', () => {
    const status = describeReview(
      { reviewState: 'submitted', reviewNote: 'left over', submittedAt: null },
      TZ,
    )
    expect(status.note).toBeUndefined()
  })

  it('an unknown stored value reads as nothing pending, as the state machine does', () => {
    expect(describeReview({ reviewState: 'approved' }, TZ)).toEqual(
      describeReview({ reviewState: null }, TZ),
    )
  })

  it('never uses the words draft, publish or collection (`04` §2.1)', () => {
    const states = [null, 'editing', 'submitted', 'changes-requested'] as const
    for (const reviewState of states) {
      const status = describeReview(
        { reviewState, reviewNote: 'Fix it.', submittedAt: '2026-10-21T15:00:00.000Z' },
        TZ,
      )
      const text = [status.heading, status.detail].join(' ').toLowerCase()
      expect(text).not.toMatch(/draft|publish|collection/)
    }
  })
})

describe('publishControlFor — which control fills the Publish slot', () => {
  it.each([
    // The school's one button, whatever the state.
    ['a school manager, nothing pending', manager, null, 'send'],
    ['a school manager, already sent', manager, 'submitted', 'send'],
    ['a school manager, sent back', manager, 'changes-requested', 'send'],
    // A page waiting for approval is approved in the queue, with its version check — never by
    // Payload's Publish, which would overwrite a later save by the school without a word.
    ['a district admin, page waiting', districtAdmin, 'submitted', 'queue'],
    ['a user holding both roles, page waiting', both, 'submitted', 'queue'],
    // Anything else, the district publishes directly (`04` §1).
    ['a district admin, nothing pending', districtAdmin, null, 'publish'],
    ['a district admin, being edited', districtAdmin, 'editing', 'publish'],
    ['a district admin, sent back', districtAdmin, 'changes-requested', 'publish'],
    ['a district admin, unknown state', districtAdmin, 'approved', 'publish'],
    ['the sync account, page waiting', sync, 'submitted', 'publish'],
    ['no user', null, 'submitted', 'publish'],
  ] as const)('%s → %s', (_label, user, reviewState, expected) => {
    expect(publishControlFor(user, reviewState)).toBe(expected)
  })
})

/**
 * What stops the button before anything is sent. Only one case today: an announcement with no
 * words (`postNeedsWords` refuses it on the server too). Stopped HERE as well because a refused
 * submit made before the editor has loaded leaves Payload's rich-text editor read-only until a
 * reload — found by `tests/e2e/announcements.spec.ts` — and because the production build loses
 * the server's sentence for a bare "The following field is invalid: body".
 */
describe('sendRefusal', () => {
  const words = {
    root: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hi' }] }],
    },
  }

  it('stops an announcement with no words, in words', () => {
    expect(sendRefusal('posts', undefined)).toBe(NEEDS_WORDS)
    expect(sendRefusal('posts', { root: { type: 'root', children: [] } })).toBe(NEEDS_WORDS)
    expect(NEEDS_WORDS).toMatch(/write the announcement/i)
  })

  it('lets an announcement with words through', () => {
    expect(sendRefusal('posts', words)).toBeNull()
  })

  it('never stops a page — an empty page body is legitimate', () => {
    expect(sendRefusal('pages', undefined)).toBeNull()
  })
})
