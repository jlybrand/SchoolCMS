import { getPayload } from 'payload'

import config from '@payload-config'

import type { StaffMember } from './types'

/**
 * Who a staff list shows (Jason, 2026-11-13) — a school's group, or a sub-group in one.
 *
 * - A SCHOOL'S GROUP: everyone at the school (`people.group`).
 * - A SUB-GROUP: the people ticked in it who are still at its school.
 * - Never anyone hidden (`active: false` — gone from CSI). A–Z by last name (`sortKey`).
 *
 * Read as the platform: staff lists are public, the collections the district's. Only what the
 * page shows leaves here — name, title, email; never a CSI id, a sort key or a sync time.
 * Runs at render and revalidate time with the page, never per visitor (`02` §5).
 */

type Row = Record<string, unknown>

const idOf = (ref: unknown): string | null =>
  ref === null || ref === undefined
    ? null
    : typeof ref === 'object'
      ? idOf((ref as { id?: unknown }).id)
      : String(ref)

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const toMember = (row: Row): StaffMember => ({
  id: String(row.id),
  name: text(row.name) ?? '',
  title: text(row.title),
  email: text(row.email),
})

export const listStaff = async (groupId: string): Promise<StaffMember[]> => {
  const payload = await getPayload({ config })
  const group = (await payload.findByID({
    collection: 'staff-groups',
    id: groupId,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })) as Row | null
  if (!group) return []

  const school = idOf(group.parent)
  const where =
    school === null
      ? { and: [{ group: { equals: group.id } }, { active: { equals: true } }] }
      : {
          and: [
            { id: { in: ((group.members ?? []) as unknown[]).map(idOf).filter(Boolean) } },
            // Still at the sub-group's school: someone who moved is not listed under it.
            { group: { equals: school } },
            { active: { equals: true } },
          ],
        }
  if (school !== null && ((group.members ?? []) as unknown[]).length === 0) return []

  const { docs } = await payload.find({
    collection: 'people',
    where: where as never,
    sort: 'sortKey',
    depth: 0,
    limit: 0,
    pagination: false,
    overrideAccess: true,
    select: { name: true, title: true, email: true },
  })
  return (docs as unknown as Row[]).map(toMember)
}
