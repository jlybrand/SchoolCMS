import type { CollectionConfig } from 'payload'

import {
  cmsOwnedField,
  peopleCreateAccess,
  peopleDeleteAccess,
  peopleReadAccess,
  peopleWriteAccess,
  syncOnlyField,
} from '@/access/people'
import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { revalidateStaffChange, revalidateStaffDelete } from '@/collections/hooks/revalidate-staff'
import { sortName } from '@/lib/people'

/**
 * The staff directory (Jason, 2026-11-13; `03` §2 `people`, its source now CSI, not PowerSchool).
 * EVERY STAFF MEMBER COMES FROM CSI — none is added in the dashboard. CSI gives a name (one
 * field), an email, a title — shown as it comes — and a location: the person's school group.
 * Those are read-only in the dashboard; the dashboard's own field here is the sort name, and the
 * district puts people in sub-groups from the sub-group (`StaffGroups.ts`). The district only
 * (`src/access/people.ts`).
 *
 * NO STUDENT DATA (CLAUDE.md rule 4): there is no field here a student's record could land in —
 * the sync maps only these fields and drops the rest.
 */

const fromCsi = { create: syncOnlyField, update: syncOnlyField }

export const People: CollectionConfig = {
  slug: 'people',
  labels: { singular: 'Staff member', plural: 'Staff' },
  admin: {
    group: 'Staff directory',
    useAsTitle: 'name',
    defaultColumns: ['name', 'title', 'email', 'group', 'active'],
    description:
      'From CSI. Names, titles, emails and schools change in CSI; the website shows them as they come.',
    hidden: ({ user }) => !isDistrictAdmin(user as AuthUser | null),
  },
  defaultSort: 'sortKey',
  access: {
    read: peopleReadAccess,
    create: peopleCreateAccess,
    update: peopleWriteAccess,
    delete: peopleDeleteAccess,
  },
  hooks: {
    afterChange: [revalidateStaffChange],
    afterDelete: [revalidateStaffDelete],
    beforeChange: [
      /** The A–Z key, from the name and the district's override, kept on the row to sort by. */
      ({ data, originalDoc }) => {
        const name = String(data?.name ?? originalDoc?.name ?? '')
        const override = (data?.sortName !== undefined ? data.sortName : originalDoc?.sortName) as
          string | null | undefined
        return { ...data, sortKey: sortName(name, override) }
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text', label: 'Name', required: true, access: fromCsi },
    { name: 'title', type: 'text', label: 'Title', access: fromCsi },
    { name: 'email', type: 'email', label: 'Email', access: fromCsi },
    {
      /**
       * The person's CSI location — one (Jason, 2026-11-13) — so their school's group. Sub-groups
       * hold their own members (`StaffGroups.ts`).
       */
      name: 'group',
      type: 'relationship',
      relationTo: 'staff-groups',
      label: 'School',
      access: fromCsi,
    },
    {
      /** Off when CSI no longer lists them: hidden from every staff list, not deleted (`11` §6). */
      name: 'active',
      type: 'checkbox',
      label: 'Shown on the website',
      defaultValue: true,
      access: fromCsi,
      admin: { position: 'sidebar' },
    },
    {
      name: 'sortName',
      type: 'text',
      label: 'Sort as',
      access: { create: cmsOwnedField, update: cmsOwnedField },
      admin: {
        position: 'sidebar',
        description:
          'Only if A–Z puts them in the wrong place. Type the name as it should sort, for example “de la Cruz, Maria”.',
      },
    },
    {
      /** What lists are ordered by — worked out on every save. */
      name: 'sortKey',
      type: 'text',
      index: true,
      admin: { hidden: true },
    },
    {
      /** CSI's own key for the person — how the sync finds them again (`11` §6). */
      name: 'csiId',
      type: 'text',
      label: 'CSI ID',
      unique: true,
      index: true,
      access: { create: syncOnlyField, update: syncOnlyField },
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'syncedAt',
      type: 'date',
      label: 'Last synced',
      access: { create: syncOnlyField, update: syncOnlyField },
      admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
    },
  ],
}
