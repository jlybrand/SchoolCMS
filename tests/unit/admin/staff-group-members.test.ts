import { describe, expect, it } from 'vitest'

import { membersShown, toggleMember } from '@/admin/StaffGroups/members'

/** The sub-group checklist (Jason, 2026-11-13): find by name, tick in, untick out. */

const staff = [
  { id: 1, name: 'José Álvarez', title: 'Nurse' },
  { id: 2, name: 'Jane Smith', title: 'Teacher' },
  { id: 3, name: 'Adam Smith', title: 'Counselor' },
]

describe('membersShown', () => {
  it('everyone, in the order given, when nothing is typed', () => {
    expect(membersShown(staff, '  ').map((p) => p.id)).toEqual([1, 2, 3])
  })

  it('names holding every word typed, ignoring case and accents', () => {
    expect(membersShown(staff, 'smith').map((p) => p.id)).toEqual([2, 3])
    expect(membersShown(staff, 'jane SMI').map((p) => p.id)).toEqual([2])
    expect(membersShown(staff, 'jose').map((p) => p.id)).toEqual([1])
    expect(membersShown(staff, 'nobody')).toEqual([])
  })
})

describe('toggleMember', () => {
  it('ticks someone in, at the end', () => {
    expect(toggleMember([2], 3)).toEqual([2, 3])
  })

  it('unticks someone out, whether stored as a number or a string', () => {
    expect(toggleMember([2, 3], 2)).toEqual([3])
    expect(toggleMember(['2', 3], 2)).toEqual([3])
  })
})
