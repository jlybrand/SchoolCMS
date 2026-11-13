import type { Access, FieldAccess } from 'payload'

import { isDistrictAdmin, isSystemSync } from './predicates'
import type { AuthUser } from './types'

/**
 * Staff directories (Jason, 2026-11-13): `people` and `staff-groups`, from CSI.
 *
 * - EVERY STAFF MEMBER COMES FROM CSI (Jason): only the sync (`system-sync`) creates one, and only
 *   the sync writes the fields that come from CSI — read-only in the dashboard, the district's
 *   included; they change in CSI.
 * - ONLY THE DISTRICT EDITS (Jason): the dashboard's own fields — a person's sort name, the
 *   sub-groups and who is in them. Schools neither see nor reach these collections.
 * - A SCHOOL'S GROUP is its CSI location: the sync makes and names it. A SUB-GROUP sits inside
 *   one (SHS › Nurses): the district makes, names and deletes it. One level only
 *   (`src/lib/staff-groups.ts`).
 * - The sync cannot delete anything: a departure is hidden (`active: false`), never deleted
 *   (`11` §6).
 *
 * Not tenant-scoped: a group is a location, not a site, and a page shows whichever group it is
 * set to.
 */

type Req = { user?: unknown } | undefined
const userOf = (req: Req): AuthUser | null => (req?.user as AuthUser | null | undefined) ?? null
const districtOrSync = (req: Req) => isDistrictAdmin(userOf(req)) || isSystemSync(userOf(req))

/** Read people and groups; update them (each field then says who may write it). */
export const peopleReadAccess: Access = ({ req }) => districtOrSync(req)
export const peopleWriteAccess: Access = ({ req }) => districtOrSync(req)

/** A staff member is created by the sync alone — none is added in the dashboard (Jason). */
export const peopleCreateAccess: Access = ({ req }) => isSystemSync(userOf(req))

export const peopleDeleteAccess: Access = ({ req }) => isDistrictAdmin(userOf(req))

/** A field that comes from CSI: the sync's alone. */
export const syncOnlyField: FieldAccess = ({ req }) => isSystemSync(userOf(req))

/** The dashboard's own fields: the district's, never the sync's — so a sync cannot overwrite them. */
export const cmsOwnedField: FieldAccess = ({ req }) => isDistrictAdmin(userOf(req))

/** A group's name on create: the sync names a school's group, the district a sub-group. */
export const groupNameCreate: FieldAccess = ({ req }) => districtOrSync(req)

/** A group's name on update: a sub-group's is the district's; a school's group's is CSI's. */
export const groupNameUpdate: FieldAccess = ({ req, doc }) => {
  const isSubGroup = (doc as { parent?: unknown } | undefined)?.parent != null
  return isSubGroup ? isDistrictAdmin(userOf(req)) : isSystemSync(userOf(req))
}

/** The district deletes sub-groups — a school's group goes only when CSI drops the location. */
export const groupDeleteAccess: Access = ({ req }) =>
  isDistrictAdmin(userOf(req)) ? { parent: { exists: true } } : false
