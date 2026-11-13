/**
 * The sub-group checklist's rules (`MembersField.tsx`). PURE.
 */

export type StaffRow = { id: number | string; name: string; title?: string | null }

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** The staff whose name holds every word typed, ignoring case and accents; all, when empty. */
export const membersShown = (staff: readonly StaffRow[], filter: string): StaffRow[] => {
  const words = fold(filter).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...staff]
  return staff.filter((person) => {
    const name = fold(person.name)
    return words.every((w) => name.includes(w))
  })
}

/** Ticked in, or unticked out — the stored ids kept as they were, in order. */
export const toggleMember = (
  current: readonly (number | string)[],
  id: number | string,
): (number | string)[] =>
  current.some((c) => String(c) === String(id))
    ? current.filter((c) => String(c) !== String(id))
    : [...current, id]
