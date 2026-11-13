import type { Payload } from 'payload'

import { assertStaffOnly, mapCsiRows, type DropReason } from '@/lib/csi/map'
import { planStaffSync, type ExistingPerson, type ExistingSchool } from '@/lib/csi/plan'

/**
 * The CSI staff sync (Jason, 2026-11-13; `11` §6–§8, the source now CSI, not PowerSchool).
 *
 *   source rows → `mapCsiRows` (allowlist; student rows dropped) → `planStaffSync` (what
 *   changed; last-known-good) → `assertStaffOnly` (stop if anything student-like got this far)
 *   → written AS THE SYNC, access rules on.
 *
 * Writing as `system-sync` with `overrideAccess: false` means the collections' own rules bound
 * it: it creates staff and school groups and writes CSI's fields — never a sort name, a
 * sub-group or who is in one, and it cannot delete (`src/access/people.ts`).
 *
 * The TRANSPORT is behind `StaffSource` (Jason: decide later). Each record is written on its
 * own; one that fails is counted and the rest go on (`11` §7).
 */

export type StaffSource = {
  /** Shown in logs: which source ran. */
  name: string
  /** Every staff row CSI has now, in whatever shape it sends — the mapper reads it. */
  fetchRows: () => Promise<unknown[]>
}

export type StaffSyncSummary =
  | {
      ok: true
      created: number
      updated: number
      hidden: number
      schoolsCreated: number
      schoolsRenamed: number
      dropped: Record<DropReason, number>
      errors: number
    }
  | { ok: false; reason: string; dropped?: Record<DropReason, number> }

/** The sync's actor: a role, not a person (`11` §8). Access functions read its roles. */
const SYNC_USER = { id: 'csi-sync', collection: 'users', roles: ['system-sync'], tenants: [] }
/**
 * Every sync write is MARKED (`STAFF_SYNC`): the collections' refresh hooks skip it, and the run
 * refreshes the sites once at the end instead (`staffSyncEndpoint`) — not 28 sites per person.
 */
export const STAFF_SYNC = 'staffSync'
const asSync = {
  user: SYNC_USER as never,
  overrideAccess: false,
  context: { [STAFF_SYNC]: true },
} as const

type Id = number | string

export const runStaffSync = async (
  payload: Payload,
  source: StaffSource,
  now: Date,
): Promise<StaffSyncSummary> => {
  let rows: unknown[]
  try {
    rows = await source.fetchRows()
  } catch (err) {
    payload.logger.error(`staff sync (${source.name}): could not read: ${(err as Error).message}`)
    return { ok: false, reason: 'Could not read from CSI. Nothing was changed.' }
  }

  const { records, dropped } = mapCsiRows(rows)
  const [{ docs: people }, { docs: schools }] = await Promise.all([
    payload.find({ collection: 'people', depth: 0, limit: 0, pagination: false, ...asSync }),
    payload.find({
      collection: 'staff-groups',
      where: { csiLocationId: { exists: true } },
      depth: 0,
      limit: 0,
      pagination: false,
      ...asSync,
    }),
  ])
  const plan = planStaffSync(records, {
    people: people as unknown as ExistingPerson[],
    schools: schools as unknown as ExistingSchool[],
  })
  if (!plan.ok) {
    payload.logger.warn(`staff sync (${source.name}): ${plan.reason}`)
    return { ok: false, reason: plan.reason, dropped }
  }
  assertStaffOnly([...plan.create])

  const syncedAt = now.toISOString()
  let errors = 0
  const attempt = async (what: string, write: () => Promise<unknown>) => {
    try {
      await write()
      return true
    } catch (err) {
      errors += 1
      // The record's CSI id only — never a name or an email in a log.
      payload.logger.error(`staff sync (${source.name}): ${what}: ${(err as Error).message}`)
      return false
    }
  }

  // School groups first: people are placed in them.
  const groupOf = new Map<string, Id>(schools.map((s) => [String(s.csiLocationId), s.id]))
  let schoolsCreated = 0
  let schoolsRenamed = 0
  for (const school of plan.schools) {
    if (school.id === undefined) {
      await attempt(`create school ${school.csiLocationId}`, async () => {
        const made = await payload.create({
          collection: 'staff-groups',
          data: { name: school.name, csiLocationId: school.csiLocationId },
          ...asSync,
        })
        groupOf.set(school.csiLocationId, made.id)
        schoolsCreated += 1
      })
    } else {
      const id = school.id
      if (
        await attempt(`rename school ${school.csiLocationId}`, () =>
          payload.update({
            collection: 'staff-groups',
            id,
            data: { name: school.name },
            ...asSync,
          }),
        )
      ) {
        schoolsRenamed += 1
      }
    }
  }

  let created = 0
  for (const r of plan.create) {
    const group = groupOf.get(r.locationId)
    if (
      await attempt(`create ${r.csiId}`, () =>
        payload.create({
          collection: 'people',
          data: {
            csiId: r.csiId,
            name: r.name,
            email: r.email || null,
            title: r.title,
            group: group as number,
            active: true,
            syncedAt,
          },
          ...asSync,
        }),
      )
    ) {
      created += 1
    }
  }

  let updated = 0
  for (const { id, data } of plan.update) {
    const { locationId, ...fields } = data
    const change: Record<string, unknown> = { ...fields, syncedAt }
    if (locationId !== undefined) change.group = groupOf.get(locationId)
    if (
      await attempt(`update ${String(id)}`, () =>
        payload.update({ collection: 'people', id, data: change, ...asSync }),
      )
    ) {
      updated += 1
    }
  }

  let hidden = 0
  for (const id of plan.hide) {
    if (
      await attempt(`hide ${String(id)}`, () =>
        payload.update({ collection: 'people', id, data: { active: false, syncedAt }, ...asSync }),
      )
    ) {
      hidden += 1
    }
  }

  const summary = {
    ok: true as const,
    created,
    updated,
    hidden,
    schoolsCreated,
    schoolsRenamed,
    dropped,
    errors,
  }
  payload.logger.info(`staff sync (${source.name}): ${JSON.stringify(summary)}`)
  return summary
}
