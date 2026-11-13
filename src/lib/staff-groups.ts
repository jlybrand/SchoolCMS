/**
 * Sub-groups (Jason, 2026-11-13): the district makes them inside a school's group — SHS has
 * Nurses, Counselors, Teachers, Media Specialist — and ticks who is in them. One level: a
 * sub-group sits in a school's group, never in another sub-group, and its members are staff at
 * that school. A school's group has no members list: everyone at the location is in it. PURE.
 */

type Group = { id: number | string; name: string; parent: unknown }
type Member = { id: number | string; name: string; group: unknown }

const idOf = (ref: unknown): string | null => {
  if (ref === null || ref === undefined || ref === '') return null
  if (typeof ref === 'object') return idOf((ref as { id?: unknown }).id)
  return String(ref)
}

export type Problem = { path: string; message: string }

export const subGroupProblems = ({
  parent,
  members,
}: {
  parent: Group | null
  members: readonly Member[]
}): Problem[] => {
  if (!parent) return [{ path: 'parent', message: 'Choose the school this group belongs to.' }]
  if (idOf(parent.parent) !== null) {
    return [{ path: 'parent', message: 'Choose a school’s group. Groups go one level deep.' }]
  }
  const elsewhere = members.filter((m) => idOf(m.group) !== String(parent.id))
  return elsewhere.length === 0
    ? []
    : [
        {
          path: 'members',
          message: `${elsewhere.map((m) => m.name).join(', ')} ${elsewhere.length === 1 ? 'isn’t' : 'aren’t'} at ${parent.name}.`,
        },
      ]
}

/** How a group is listed: a sub-group with its school, so two schools' "Nurses" differ. */
export const groupLabel = (name: string, parentName: string | null): string =>
  parentName ? `${parentName} › ${name}` : name

/**
 * Members still at the school, in their order. The sync moves people between schools but never
 * touches who is in a sub-group, so someone who moved drops out on the sub-group's next save
 * rather than blocking it; only someone being ADDED from another school is refused.
 */
export const keepAtSchool = <M extends Member>(
  schoolId: number | string,
  members: readonly M[],
): M[] => members.filter((m) => idOf(m.group) === String(schoolId))
