import type { StaffMember } from '@/content/types'

/**
 * The staff list's name filter (Jason, 2026-11-13). PURE. Every word typed must be in the name
 * or the title — "smith", "jane smi", "counselor" — ignoring case and accents. Nothing typed:
 * everyone, in the order given (A–Z by last name).
 */

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export const staffShown = (staff: readonly StaffMember[], filter: string): StaffMember[] => {
  const words = fold(filter).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...staff]
  return staff.filter((person) => {
    const haystack = fold(`${person.name} ${person.title ?? ''}`)
    return words.every((w) => haystack.includes(w))
  })
}
