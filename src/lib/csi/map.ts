/**
 * CSI rows → staff records (Jason, 2026-11-13; `11` §3–§4, the source now CSI, not PowerSchool).
 * PURE. Layers 3 and 4 of the no-student-data defense (CLAUDE.md rule 4):
 *
 * - ALLOWLIST: a record is built from these fields alone — anything else in a row (a home
 *   address, a salary, whatever CSI adds tomorrow) is never read into it.
 * - STUDENT MARKERS: a row that looks like a student's — a "student" title or role, or any
 *   grade, guardian or date-of-birth field — is DROPPED and COUNTED, never stored, and nothing
 *   about it is kept: the counts name no one. CSI holds no student data (Jason); this proves it
 *   stays that way rather than assuming it.
 *
 * THE ROW SHAPE IS ASSUMED (`tests/fixtures/csi/README.md`): there is no CSI access yet. When a
 * real export is captured, fix the field names here and nowhere else.
 */

export const CSI_STAFF_FIELDS = [
  'csiId',
  'name',
  'email',
  'title',
  'locationId',
  'locationName',
] as const

export type StaffRecord = Record<(typeof CSI_STAFF_FIELDS)[number], string>

export type DropReason = 'student' | 'incomplete' | 'duplicate'

export type MapResult = { records: StaffRecord[]; dropped: Record<DropReason, number> }

/** Field names that only a student's record would carry. Checked on every key of a row. */
const STUDENT_KEY = /student|grade|guardian|parent|birth|dob|homeroom|enroll/i
/** A title or role that names a student. */
const STUDENT_WORD = /\b(student|pupil)s?\b/i

const str = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

const hasValue = (value: unknown) =>
  value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '')

const looksLikeStudent = (row: Record<string, unknown>): boolean =>
  Object.entries(row).some(
    ([key, value]) =>
      (STUDENT_KEY.test(key) && hasValue(value)) ||
      ((key === 'title' || key === 'role' || key === 'type') && STUDENT_WORD.test(str(value))),
  )

export const mapCsiRows = (rows: readonly unknown[]): MapResult => {
  const dropped: Record<DropReason, number> = { student: 0, incomplete: 0, duplicate: 0 }
  const records: StaffRecord[] = []
  const seen = new Set<string>()

  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      dropped.incomplete += 1
      continue
    }
    const row = raw as Record<string, unknown>
    if (looksLikeStudent(row)) {
      dropped.student += 1
      continue
    }
    const record: StaffRecord = {
      csiId: str(row.employeeId),
      name: str(row.name),
      email: str(row.email).toLowerCase(),
      title: str(row.title),
      locationId: str(row.locationId),
      locationName: str(row.locationName),
    }
    if (record.csiId === '' || record.name === '' || record.locationId === '') {
      dropped.incomplete += 1
      continue
    }
    if (seen.has(record.csiId)) {
      dropped.duplicate += 1
      continue
    }
    seen.add(record.csiId)
    records.push(record)
  }
  return { records, dropped }
}

/**
 * Layer 5: the last check before anything is written. Independent of the mapper above — if a
 * change there ever let a student-like record through, the run stops here, whole, and the
 * message names no one.
 */
export const assertStaffOnly = (records: readonly StaffRecord[]): void => {
  for (const record of records) {
    if (looksLikeStudent(record)) {
      throw new Error(
        'Stopped: a record that looks like a student’s reached the write step. Nothing was written.',
      )
    }
  }
}
