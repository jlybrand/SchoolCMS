import { describe, expect, it } from 'vitest'

import { grantRows } from '@/admin/Grants/grants'

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
        manager('7', ['posts:routine'], { name: 'Zoe Park' }),
        manager('4', ['events:schedule', 'posts:routine'], { name: 'Ana Ruiz' }),
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
        manager('9', ['posts:routine'], { name: ' ', email: 'a@dd2.org' }),
        manager('10', ['posts:routine']),
      ]).map((r) => r.person),
    ).toEqual(['a@dd2.org', 'User 10'])
  })

  it('ignores values that are not grants', () => {
    expect(grantRows([manager('1', ['everything'])])).toEqual([])
  })
})
