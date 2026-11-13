import type { StaffSource } from './staff-sync'

/**
 * A MOCK CSI (Jason, 2026-11-13): there is no CSI access yet. One school's staff in the ASSUMED
 * row shape (`tests/fixtures/csi/README.md`), plainly fake — "(mock)" in the school's name,
 * example.org addresses. Used by the seed, and by the sync when `CSI_SOURCE=mock`. Staff only:
 * the student-seeded rows that prove the invariant are a test fixture, never seeded.
 */

const mock = (name: string, title: string) => {
  const id = `MOCK-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return {
    employeeId: id,
    name,
    email: `${id.toLowerCase()}@example.org`,
    title,
    locationId: 'MOCK-SHS',
    locationName: 'SHS (mock)',
  }
}

export const MOCK_CSI_ROWS = [
  mock('Avery Mockwell', 'Teacher'),
  mock('Blake Testman', 'Teacher'),
  mock('Casey Sample', 'School Counselor'),
  mock('Dana Example', 'Nurse'),
  mock('Emery Placeholder', 'Media Specialist'),
  mock('Finley Fixture', 'Admin/teacher'),
  mock('Gray Stub', 'Secretary'),
  mock('José Álvarez-Mock', 'Teaching Assistant'),
]

export const mockStaffSource: StaffSource = {
  name: 'mock',
  fetchRows: async () => MOCK_CSI_ROWS.map((row) => ({ ...row })),
}

/**
 * The source the sync reads, from `CSI_SOURCE`. Only `mock` exists until CSI access arrives and
 * the transport is chosen (Jason: decide later) — then a real source joins here. Unset: none,
 * and the sync does nothing.
 */
export const staffSourceFromEnv = (): StaffSource | null =>
  process.env.CSI_SOURCE === 'mock' ? mockStaffSource : null
