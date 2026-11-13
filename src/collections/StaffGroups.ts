import { ValidationError, type CollectionConfig } from 'payload'

import {
  cmsOwnedField,
  groupDeleteAccess,
  groupNameCreate,
  groupNameUpdate,
  peopleReadAccess,
  peopleWriteAccess,
  syncOnlyField,
} from '@/access/people'
import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { revalidateStaffChange, revalidateStaffDelete } from '@/collections/hooks/revalidate-staff'
import { groupLabel, keepAtSchool, subGroupProblems } from '@/lib/staff-groups'

/**
 * Staff groups (Jason, 2026-11-13). Two levels:
 *
 * - A SCHOOL'S GROUP is its CSI location: the sync makes and names it, and everyone at the
 *   location is in it — it has no members list.
 * - A SUB-GROUP sits inside one (SHS › Nurses, Counselors, Teachers, Media Specialist): the
 *   district makes it, names it and ticks who is in it, from that school's staff. The sync never
 *   touches it.
 *
 * A staff list on a page shows one group or sub-group (part C). The district only
 * (`src/access/people.ts`); the rules are `src/lib/staff-groups.ts`.
 */

type Ref = number | string
const idOf = (ref: unknown): Ref | null =>
  ref === null || ref === undefined || ref === ''
    ? null
    : typeof ref === 'object'
      ? idOf((ref as { id?: unknown }).id)
      : (ref as Ref)

export const StaffGroups: CollectionConfig = {
  slug: 'staff-groups',
  labels: { singular: 'Staff group', plural: 'Staff groups' },
  admin: {
    group: 'Staff directory',
    useAsTitle: 'label',
    defaultColumns: ['label'],
    description:
      'Each school’s group comes from CSI. Make sub-groups inside one — Nurses, Counselors, Teachers — and tick who is in them.',
    hidden: ({ user }) => !isDistrictAdmin(user as AuthUser | null),
  },
  defaultSort: 'label',
  access: {
    read: peopleReadAccess,
    create: peopleWriteAccess,
    update: peopleWriteAccess,
    delete: groupDeleteAccess,
  },
  hooks: {
    afterChange: [revalidateStaffChange],
    afterDelete: [revalidateStaffDelete],
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        const name = String(data?.name ?? originalDoc?.name ?? '')
        const memberIds = ((data?.members !== undefined ? data.members : originalDoc?.members) ??
          []) as unknown[]

        // A school's group: it has a CSI location, which only the sync can set. Everyone at the
        // location is in it, so it takes no members list of its own.
        if (data?.csiLocationId || originalDoc?.csiLocationId) {
          if (memberIds.length > 0) {
            throw new ValidationError({
              errors: [
                {
                  path: 'members',
                  message: 'Everyone at the school is in its group. Tick people in a sub-group.',
                },
              ],
            })
          }
          return { ...data, label: groupLabel(name, null) }
        }

        // Anything else is a sub-group: it needs a school's group to sit in.
        const parentId = idOf(data?.parent !== undefined ? data.parent : originalDoc?.parent)
        const parent =
          parentId === null
            ? null
            : await req.payload.findByID({
                collection: 'staff-groups',
                id: parentId,
                depth: 0,
                overrideAccess: true,
                disableErrors: true,
                req,
              })
        const ids = memberIds.map(idOf).filter((id): id is Ref => id !== null)
        const members =
          ids.length === 0
            ? []
            : (
                await req.payload.find({
                  collection: 'people',
                  where: { id: { in: ids } },
                  depth: 0,
                  limit: ids.length,
                  pagination: false,
                  overrideAccess: true,
                  req,
                })
              ).docs
        // Only someone being ADDED from another school is refused. Someone already in it who
        // has since moved school (the sync moves people, never membership) drops out quietly.
        const before = new Set(
          ((originalDoc?.members ?? []) as unknown[]).map((m) => String(idOf(m))),
        )
        const rows = members.map((m) => ({ id: m.id, name: m.name, group: m.group }))
        const problems = subGroupProblems({
          parent: parent ? { id: parent.id, name: parent.name, parent: parent.parent } : null,
          members: rows.filter((m) => !before.has(String(m.id))),
        })
        if (problems.length > 0) throw new ValidationError({ errors: problems })
        const staying = new Set(keepAtSchool(parent!.id, rows).map((m) => String(m.id)))
        return {
          ...data,
          ...(ids.length > 0 ? { members: ids.filter((id) => staying.has(String(id))) } : {}),
          label: groupLabel(name, parent?.name ?? null),
        }
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Name',
      required: true,
      access: { create: groupNameCreate, update: groupNameUpdate },
    },
    {
      /** The school's group this sub-group sits in. Set when it is made; never moved. */
      name: 'parent',
      type: 'relationship',
      relationTo: 'staff-groups',
      label: 'School',
      access: { create: cmsOwnedField, update: () => false },
      filterOptions: { parent: { exists: false } },
      admin: {
        description: 'The school’s group this sits in.',
        condition: (data) => !data?.csiLocationId,
      },
    },
    {
      /** Who is in a sub-group: ticked from the school's staff (`MembersField`). */
      name: 'members',
      type: 'relationship',
      relationTo: 'people',
      hasMany: true,
      label: 'Who’s in this group',
      access: { create: cmsOwnedField, update: cmsOwnedField },
      admin: {
        condition: (data) => !data?.csiLocationId,
        components: { Field: '/admin/StaffGroups/MembersField#MembersField' },
      },
    },
    {
      /** How the group is listed: "SHS › Nurses" — worked out on every save. */
      name: 'label',
      type: 'text',
      index: true,
      admin: { hidden: true },
    },
    {
      /** CSI's own key for a school's location — how the sync finds the group again. */
      name: 'csiLocationId',
      type: 'text',
      label: 'CSI location',
      unique: true,
      index: true,
      access: { create: syncOnlyField, update: syncOnlyField },
      admin: { readOnly: true, position: 'sidebar', condition: (data) => !!data?.csiLocationId },
    },
  ],
}
