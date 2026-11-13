import type { StaffRecord } from './map'

export type { StaffRecord } from './map'

/**
 * One sync's changes (Jason, 2026-11-13; `11` §6–§7). PURE — `src/sync/staff-sync.ts` applies it.
 *
 * - Upsert by CSI id. Only what changed is written, so an unchanged feed is a no-op: no
 *   versions, no churn.
 * - Someone gone from the feed is HIDDEN (`active: false`), never deleted; someone back is shown.
 * - A new location gets its school's group; a renamed location renames it.
 * - LAST-KNOWN-GOOD: a feed that would empty the directory, or hide more than a quarter of it
 *   (and more than a handful), is refused whole. A broken export must not blank the sites.
 */

type Id = number | string

export type ExistingPerson = {
  id: Id
  csiId?: string | null
  name?: string | null
  email?: string | null
  title?: string | null
  group?: unknown
  active?: boolean | null
}

export type ExistingSchool = { id: Id; csiLocationId?: string | null; name?: string | null }

export type PersonChange = Partial<{
  name: string
  email: string
  title: string
  locationId: string
  active: boolean
}>

export type StaffPlan =
  | {
      ok: true
      /** New school groups, and renamed ones (with their id). */
      schools: { id?: Id; csiLocationId: string; name: string }[]
      create: StaffRecord[]
      update: { id: Id; data: PersonChange }[]
      hide: Id[]
    }
  | { ok: false; reason: string }

/** Departures beyond this many, and beyond this share of the directory, refuse the run. */
const HANDFUL = 5
const SHARE = 0.25

const idOf = (ref: unknown): string | null =>
  ref === null || ref === undefined
    ? null
    : typeof ref === 'object'
      ? idOf((ref as { id?: unknown }).id)
      : String(ref)

export const planStaffSync = (
  records: readonly StaffRecord[],
  existing: { people: readonly ExistingPerson[]; schools: readonly ExistingSchool[] },
): StaffPlan => {
  if (records.length === 0) {
    return { ok: false, reason: 'The CSI feed had no staff in it. Nothing was changed.' }
  }

  // School groups: new locations, and renamed ones.
  const schoolByLocation = new Map(existing.schools.map((s) => [s.csiLocationId ?? '', s]))
  const locationOfGroup = new Map(
    existing.schools.map((s) => [String(s.id), s.csiLocationId ?? '']),
  )
  const schools: { id?: Id; csiLocationId: string; name: string }[] = []
  const named = new Set<string>()
  for (const r of records) {
    if (named.has(r.locationId)) continue
    named.add(r.locationId)
    const name = r.locationName || r.locationId
    const school = schoolByLocation.get(r.locationId)
    if (!school) schools.push({ csiLocationId: r.locationId, name })
    else if (school.name !== name)
      schools.push({ id: school.id, csiLocationId: r.locationId, name })
  }

  // People: create, update what changed, hide who is gone.
  const byCsi = new Map(
    existing.people.filter((p) => p.csiId).map((p) => [p.csiId as string, p] as const),
  )
  const create: StaffRecord[] = []
  const update: { id: Id; data: PersonChange }[] = []
  for (const r of records) {
    const p = byCsi.get(r.csiId)
    if (!p) {
      create.push(r)
      continue
    }
    const data: PersonChange = {}
    if ((p.name ?? '') !== r.name) data.name = r.name
    if ((p.email ?? '') !== r.email) data.email = r.email
    if ((p.title ?? '') !== r.title) data.title = r.title
    const group = idOf(p.group)
    if ((group === null ? '' : (locationOfGroup.get(group) ?? '')) !== r.locationId) {
      data.locationId = r.locationId
    }
    if (p.active === false) data.active = true
    if (Object.keys(data).length > 0) update.push({ id: p.id, data })
  }

  const inFeed = new Set(records.map((r) => r.csiId))
  const active = existing.people.filter((p) => p.active !== false)
  const hide = active.filter((p) => !p.csiId || !inFeed.has(p.csiId)).map((p) => p.id)
  if (hide.length > HANDFUL && hide.length > active.length * SHARE) {
    return {
      ok: false,
      reason: `The CSI feed would hide ${hide.length} of ${active.length} staff (more than a quarter). Nothing was changed — check the feed, then sync again.`,
    }
  }

  return { ok: true, schools, create, update, hide }
}
