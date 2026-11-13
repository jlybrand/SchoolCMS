import { describe, expect, it } from 'vitest'

import { staffShown } from '@/blocks/StaffList/staff-filter'

/** The staff list's name filter (Jason, 2026-11-13): words in the name or title, any case or accent. */

const staff = [
  { id: '1', name: 'José Álvarez', title: 'Nurse', email: null },
  { id: '2', name: 'Jane Smith', title: 'Teacher', email: null },
  { id: '3', name: 'Adam Smith', title: 'School Counselor', email: null },
]

describe('staffShown', () => {
  it('everyone, in order, when nothing is typed', () => {
    expect(staffShown(staff, '').map((p) => p.id)).toEqual(['1', '2', '3'])
  })

  it('every word in the name or the title', () => {
    expect(staffShown(staff, 'smith').map((p) => p.id)).toEqual(['2', '3'])
    expect(staffShown(staff, 'jane smi').map((p) => p.id)).toEqual(['2'])
    expect(staffShown(staff, 'counselor').map((p) => p.id)).toEqual(['3'])
    expect(staffShown(staff, 'JOSE alv').map((p) => p.id)).toEqual(['1'])
    expect(staffShown(staff, 'nobody')).toEqual([])
  })
})
