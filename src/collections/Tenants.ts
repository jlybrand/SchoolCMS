import type { CollectionConfig } from 'payload'

import { districtOnly } from '@/access/tenant-scoped'
import { isDistrictAdmin, tenantIdsFor } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

/**
 * `tenants` — the spine (`03` §2). One document per site: 1 district + 27 schools.
 *
 * **Adding a tenant is data, not DevOps.** DNS is already wildcarded and TLS is a wildcard
 * cert, so creating a row is the whole procedure (`09` §7). Nothing in this collection may
 * hardcode the count of 28 (`01` §8).
 */
export const Tenants: CollectionConfig = {
  slug: 'tenants',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'hostname', 'type', 'status'],
    group: 'Administration',
  },
  access: {
    /**
     * Scoped read rather than `districtOnly`: a school-manager must be able to resolve
     * their own tenant for the admin UI, but must not enumerate the other 27.
     *
     * The public site does NOT read through this path — hostname resolution happens in the
     * content-access layer via the Local API with access overridden (Phase 2), so no
     * anonymous read is granted here.
     */
    read: ({ req }) => {
      const user = (req?.user as AuthUser) ?? null
      if (!user) return false
      if (isDistrictAdmin(user)) return true

      const ids = tenantIdsFor(user)
      if (ids.length === 0) return false
      return { id: { in: ids } }
    },
    create: districtOnly,
    update: districtOnly,
    delete: districtOnly,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'Display name, e.g. "Summerville Middle School".' },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { description: 'Stable identifier, e.g. "summerville-ms". Do not change once live.' },
    },
    {
      name: 'hostname',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description:
          'Drives routing — every request Host maps to exactly one tenant (`02` §4.1). Must sit within the wildcard zone.',
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'school',
      options: [
        { label: 'School', value: 'school' },
        { label: 'District', value: 'district' },
      ],
      admin: {
        description:
          'District is the syndication source and the only tenant permitted composed pages (`03` §2).',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Hidden', value: 'hidden' },
      ],
    },
    {
      name: 'powerSchoolBuildingId',
      type: 'text',
      index: true,
      admin: {
        description:
          'Building ID for the staff sync (`11` §5). Unmapped buildings are logged and skipped — never guessed. STAFF ONLY; no student data enters this platform.',
      },
    },
  ],
}
