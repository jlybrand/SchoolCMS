import { describe, expect, it } from 'vitest'

import rows from '../../fixtures/csi/staff-with-students.json'

import { assertStaffOnly, CSI_STAFF_FIELDS, mapCsiRows } from '@/lib/csi/map'

/**
 * CSI rows → staff records (Jason, 2026-11-13; `11` §3–§4, the source now CSI). The mapper keeps
 * ONLY the allowlisted fields and DROPS — counted, never stored — any row carrying a student
 * marker, any row missing what a staff record needs, and a second row for the same person.
 * CSI holds no student data; the fixture plants some anyway, because the invariant is proved,
 * not assumed (CLAUDE.md rule 4, `11` §9).
 */

const result = mapCsiRows(rows)

describe('staff kept', () => {
  it('the four real staff rows, trimmed, email lowercased', () => {
    expect(result.records).toEqual([
      {
        csiId: 'E100',
        name: 'Avery Mockwell',
        email: 'avery.mockwell@example.org',
        title: 'Teacher',
        locationId: 'L-SHS',
        locationName: 'SHS',
      },
      {
        csiId: 'E101',
        name: 'Casey Sample',
        email: 'casey.sample@example.org',
        title: 'School Counselor',
        locationId: 'L-SHS',
        locationName: 'SHS',
      },
      {
        csiId: 'E102',
        name: 'Finley Fixture',
        email: 'finley.fixture@example.org',
        title: 'Admin/teacher',
        locationId: 'L-AMS',
        locationName: 'AMS',
      },
      {
        csiId: 'E103',
        name: 'Dana Example',
        email: 'dana.example@example.org',
        title: 'Nurse',
        locationId: 'L-AMS',
        locationName: 'AMS',
      },
    ])
  })

  it('only the allowlisted fields — a home address or a salary never comes through', () => {
    for (const record of result.records) {
      expect(Object.keys(record).sort()).toEqual([...CSI_STAFF_FIELDS].sort())
    }
    expect(JSON.stringify(result.records)).not.toMatch(/Elm St|55000/)
  })
})

describe('NO STUDENT DATA — every planted student row is dropped and counted', () => {
  it('by title, a grade, a guardian, a student role, a date of birth', () => {
    expect(result.dropped.student).toBe(5)
    const kept = result.records.map((r) => r.csiId)
    for (const id of ['S900', 'S901', 'S902', 'S903', 'S904']) expect(kept).not.toContain(id)
  })

  it('the count says why, and names nobody — no student’s details in a log', () => {
    expect(JSON.stringify(result.dropped)).not.toMatch(/Mockchild|Rowe|Learner|Pupil|Minor/)
  })
})

describe('rows that are not a whole staff record', () => {
  it('no id, no name or no location is dropped as incomplete', () => {
    expect(result.dropped.incomplete).toBe(3)
  })

  it('a second row for the same person is dropped; the first stands', () => {
    expect(result.dropped.duplicate).toBe(1)
    expect(result.records.find((r) => r.csiId === 'E100')?.name).toBe('Avery Mockwell')
  })

  it('anything that is not a row at all is dropped as incomplete', () => {
    expect(mapCsiRows([null, 'x', 42, []]).dropped.incomplete).toBe(4)
  })
})

describe('the last check before anything is written (layer 5)', () => {
  it('passes staff records', () => {
    expect(() => assertStaffOnly(result.records)).not.toThrow()
  })

  it('stops the whole run if a student-like record reached it, naming no one', () => {
    const slipped = { ...result.records[0]!, title: 'Student' }
    expect(() => assertStaffOnly([...result.records, slipped])).toThrow(
      'Stopped: a record that looks like a student’s reached the write step. Nothing was written.',
    )
  })
})
