import { describe, expect, it } from 'vitest'

import { autoApprovalRows, grantRows } from '@/admin/Grants/grants'

/** The dashboard's list of who holds an auto-approval grant (`04` §4.3 governance). */

const manager = (id: string, autoApprove: unknown, extra: Record<string, unknown> = {}) =>
  ({ id, roles: ['school-manager'], autoApprove, ...extra }) as never

describe('grantRows', () => {
  it('is empty when nobody holds a grant — the launch posture', () => {
    expect(grantRows([manager('1', []), manager('2', null), manager('3', undefined)])).toEqual([])
  })

  it('lists each holder once with the grants in words, by name', () => {
    expect(
      grantRows([
        manager('7', ['posts.routine'], { name: 'Zoe Park' }),
        manager('4', ['events.schedule', 'posts.routine'], { name: 'Ana Ruiz' }),
      ]),
    ).toEqual([
      {
        userId: '4',
        person: 'Ana Ruiz',
        grants: ['Events: schedule-only changes', 'Posts: routine posts'],
      },
      { userId: '7', person: 'Zoe Park', grants: ['Posts: routine posts'] },
    ])
  })

  it('falls back to the email, then the id, when there is no name', () => {
    expect(
      grantRows([
        manager('9', ['posts.routine'], { name: ' ', email: 'a@dd2.org' }),
        manager('10', ['posts.routine']),
      ]).map((r) => r.person),
    ).toEqual(['a@dd2.org', 'User 10'])
  })

  it('ignores values that are not grants', () => {
    expect(grantRows([manager('1', ['everything'])])).toEqual([])
  })
})

/**
 * The post-hoc list (`04` §4.3): "auto-approved changes from the last 30 days, so the district
 * can spot-check that a grant is still warranted." Built from the audit trail's auto-approve
 * entries; newest first.
 */
describe('autoApprovalRows', () => {
  const entry = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
    id,
    action: 'auto-approve',
    autoApproved: true,
    contentType: 'posts',
    documentId: '9',
    documentTitle: 'Picture day',
    actorLabel: 'm@dd2.org',
    createdAt,
    ...extra,
  })

  it('says what, who, when, and links to it', () => {
    expect(autoApprovalRows([entry('1', '2026-10-28T15:00:00.000Z')], 'America/New_York')).toEqual([
      {
        id: '1',
        title: 'Picture day',
        href: '/admin/collections/posts/9',
        who: 'm@dd2.org',
        when: 'October 28',
      },
    ])
  })

  it('newest first, and anything that is not an auto-approval is left out', () => {
    const rows = autoApprovalRows(
      [
        entry('1', '2026-10-20T15:00:00.000Z'),
        entry('2', '2026-10-28T15:00:00.000Z'),
        entry('3', '2026-10-27T15:00:00.000Z', { action: 'approve', autoApproved: false }),
      ],
      'America/New_York',
    )
    expect(rows.map((r) => r.id)).toEqual(['2', '1'])
  })

  it('a document since deleted is still listed, by the title it had, without a link', () => {
    const [row] = autoApprovalRows(
      [entry('1', '2026-10-28T15:00:00.000Z', { documentId: '' })],
      'America/New_York',
    )
    expect(row).toMatchObject({ title: 'Picture day', href: null })
  })
})
