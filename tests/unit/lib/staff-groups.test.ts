import { describe, expect, it } from 'vitest'

import { groupLabel, keepAtSchool, subGroupProblems } from '@/lib/staff-groups'

/**
 * Sub-groups (Jason, 2026-11-13): the district makes them inside a school's group — SHS has
 * Nurses, Counselors, Teachers, Media Specialist — and ticks who is in them. One level: a
 * sub-group sits in a school's group, never in another sub-group; its members are staff at that
 * school. A school's group itself has no members list — everyone at the location is in it.
 */

const shs = { id: 1, name: 'SHS', parent: null }
const nurses = { id: 2, name: 'Nurses', parent: 1 }

describe('subGroupProblems', () => {
  it('a sub-group of a school, with that school’s staff, is fine', () => {
    expect(
      subGroupProblems({
        parent: shs,
        members: [
          { id: 10, name: 'Jane Smith', group: 1 },
          { id: 11, name: 'Ann Lee', group: 1 },
        ],
      }),
    ).toEqual([])
  })

  it('needs a school to sit in', () => {
    expect(subGroupProblems({ parent: null, members: [] })).toEqual([
      { path: 'parent', message: 'Choose the school this group belongs to.' },
    ])
  })

  it('sits in a school’s group, not in another sub-group', () => {
    expect(subGroupProblems({ parent: nurses, members: [] })).toEqual([
      { path: 'parent', message: 'Choose a school’s group. Groups go one level deep.' },
    ])
  })

  it('names anyone who is not at that school', () => {
    expect(
      subGroupProblems({
        parent: shs,
        members: [
          { id: 10, name: 'Jane Smith', group: 1 },
          { id: 12, name: 'Bo Diaz', group: 3 },
        ],
      }),
    ).toEqual([{ path: 'members', message: 'Bo Diaz isn’t at SHS.' }])
  })
})

describe('groupLabel', () => {
  it('a school’s group by its name; a sub-group with its school, so two “Nurses” differ', () => {
    expect(groupLabel('SHS', null)).toBe('SHS')
    expect(groupLabel('Nurses', 'SHS')).toBe('SHS › Nurses')
  })
})

describe('someone who moved school (Jason, 2026-11-13)', () => {
  // The sync moves people between schools but never touches who is in a sub-group, so a
  // sub-group can hold someone no longer at its school. They drop out on its next save — and
  // only someone being ADDED from another school is refused.
  it('keepAtSchool drops members no longer at the school, keeping the order', () => {
    expect(
      keepAtSchool(1, [
        { id: 10, name: 'Jane Smith', group: 1 },
        { id: 12, name: 'Bo Diaz', group: 3 },
        { id: 11, name: 'Ann Lee', group: { id: 1 } },
      ]).map((m) => m.id),
    ).toEqual([10, 11])
  })
})
