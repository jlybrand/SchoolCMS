import { describe, expect, it } from 'vitest'

import { missingSchool, NEEDS_SCHOOL } from '@/access/user-school'

/**
 * A school manager must be assigned a school.
 *
 * Without one, every tenant-scoped access function refuses them (correctly — they fail
 * closed), so the account signs in to an admin that shows nothing but their own user record,
 * with no word as to why. Against the usability bar that is a broken account, and the place to
 * stop it is the save that creates it, not the sign-in that discovers it.
 *
 * Pure: `data` is what the write sends, `originalDoc` what is stored. A partial update — a
 * password change, say — sends neither roles nor tenants, so the stored ones decide.
 */

const A = { tenant: 1 }
const B = { tenant: { id: 2 } }

describe('missingSchool', () => {
  it.each([
    ['a new manager with a school', { roles: ['school-manager'], tenants: [A] }, undefined, null],
    [
      'a new manager with two schools',
      { roles: ['school-manager'], tenants: [A, B] },
      undefined,
      null,
    ],
    ['a new manager with no tenants array', { roles: ['school-manager'] }, undefined, NEEDS_SCHOOL],
    [
      'a new manager with an empty array',
      { roles: ['school-manager'], tenants: [] },
      undefined,
      NEEDS_SCHOOL,
    ],
    // The admin's "Add" button makes a row before anything is picked in it.
    [
      'a new manager with only a blank row',
      { roles: ['school-manager'], tenants: [{ tenant: null }] },
      undefined,
      NEEDS_SCHOOL,
    ],
    [
      'a row with no tenant key',
      { roles: ['school-manager'], tenants: [{}] },
      undefined,
      NEEDS_SCHOOL,
    ],
    // District admins work across all 28 sites (`04` §3.2) and need no assignment.
    [
      'a district admin with no school',
      { roles: ['district-admin'], tenants: [] },
      undefined,
      null,
    ],
    ['the sync account with no school', { roles: ['system-sync'] }, undefined, null],
    ['no roles at all', { roles: [] }, undefined, null],
    // Flat roles (`03` §6.1): holding school-manager means managing a school, whatever else.
    [
      'both roles and no school',
      { roles: ['district-admin', 'school-manager'], tenants: [] },
      undefined,
      NEEDS_SCHOOL,
    ],
  ] as const)('%s', (_label, data, originalDoc, expected) => {
    expect(missingSchool(data, originalDoc)).toBe(expected)
  })

  describe('on update, stored values fill what the write does not send', () => {
    const storedManager = { roles: ['school-manager'], tenants: [A] }
    const legacyManager = { roles: ['school-manager'], tenants: [] }

    it('a password-only change to a manager with a school passes', () => {
      expect(missingSchool({ password: 'x' }, storedManager)).toBeNull()
    })

    it('removing the last school from a manager is refused', () => {
      expect(missingSchool({ tenants: [] }, storedManager)).toBe(NEEDS_SCHOOL)
    })

    it('making a schoolless user a manager is refused', () => {
      expect(missingSchool({ roles: ['school-manager'] }, { roles: [], tenants: [] })).toBe(
        NEEDS_SCHOOL,
      )
    })

    it('making a user a manager and giving them a school in one save passes', () => {
      expect(missingSchool({ roles: ['school-manager'], tenants: [A] }, { roles: [] })).toBeNull()
    })

    it('a manager stored without a school must be given one before anything else saves', () => {
      // Accounts made before this rule. Refusing their next save is what surfaces them.
      expect(missingSchool({ name: 'New name' }, legacyManager)).toBe(NEEDS_SCHOOL)
      expect(missingSchool({ tenants: [A] }, legacyManager)).toBeNull()
    })

    it('demoting a schoolless manager to district admin passes', () => {
      expect(missingSchool({ roles: ['district-admin'] }, legacyManager)).toBeNull()
    })
  })

  it('a malformed write fails toward asking for a school, never toward passing silently', () => {
    expect(missingSchool({ roles: ['school-manager'], tenants: 'A' }, undefined)).toBe(NEEDS_SCHOOL)
    expect(missingSchool(undefined, { roles: ['school-manager'] })).toBe(NEEDS_SCHOOL)
  })

  it('says what to do and why, in plain words', () => {
    expect(NEEDS_SCHOOL).toMatch(/school/i)
    expect(NEEDS_SCHOOL).not.toMatch(/tenant|collection/i)
  })
})
