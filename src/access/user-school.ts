/**
 * A school manager must be assigned at least one school.
 *
 * Not an access rule — the access functions already refuse a schoolless manager everything,
 * failing closed (`tenant-scoped.ts`), and that stays the guarantee for any row that predates
 * this check. This is the usability half: such an account signs in to an admin showing only
 * its own user record and no reason, so the save that would create one is refused instead,
 * with a sentence saying what to do.
 *
 * Wired as a `beforeValidate` hook on `users`, so the REST and Local API paths cannot skip it.
 */

/** Plain words: the district admin reading this has no reason to know the word "tenant". */
export const NEEDS_SCHOOL =
  'Choose the school this person manages. A school manager without a school cannot see or edit anything.'

type UserShape = { roles?: unknown; tenants?: unknown; [field: string]: unknown } | null | undefined

/**
 * `data` is what the write sends, `originalDoc` what is stored (absent on create). A field
 * the write does not send is taken from the stored document, so a password change on a
 * manager with a school passes, and any save on a manager stored without one is refused until
 * a school is chosen — which is how accounts made before this rule surface.
 *
 * Returns the message to show, or null when the user is fine.
 */
export const missingSchool = (data: UserShape, originalDoc?: UserShape): string | null => {
  const roles = data?.roles !== undefined ? data.roles : originalDoc?.roles
  if (!Array.isArray(roles) || !roles.includes('school-manager')) return null

  const tenants = data?.tenants !== undefined ? data.tenants : originalDoc?.tenants
  // A row the admin's "Add" button made, with nothing picked in it, is not a school.
  const assigned =
    Array.isArray(tenants) &&
    tenants.some((row: unknown) => {
      const tenant = (row as { tenant?: unknown } | null)?.tenant
      return tenant !== undefined && tenant !== null && tenant !== ''
    })

  return assigned ? null : NEEDS_SCHOOL
}
