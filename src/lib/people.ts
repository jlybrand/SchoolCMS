/**
 * A–Z by last name (Jason, 2026-11-13). CSI gives one name field, so the last name is its last
 * word — a suffix skipped, "Last, First" taken as written — and the district sets a sort name
 * for anyone that gets wrong ("de la Cruz"). PURE.
 */

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

const isSuffix = (word: string) => SUFFIXES.has(word.toLowerCase().replace(/[.,]/g, ''))

const words = (name: string) => name.trim().split(/\s+/).filter(Boolean)

/** "Last, First" — a comma not just before a suffix ("Ann Lee, Sr." is not one). */
const commaParts = (name: string): [string, string] | null => {
  const at = name.indexOf(',')
  if (at < 0) return null
  const last = name.slice(0, at).trim()
  const rest = name.slice(at + 1).trim()
  if (rest === '' || words(rest).every(isSuffix)) return null
  return [last, rest]
}

/** The name without a trailing suffix, and the suffix. */
const splitSuffix = (name: string): { body: string[]; suffix: string[] } => {
  const all = words(name.replace(/,(?=\s*\S+\s*$)/, ' '))
  const suffix: string[] = []
  while (all.length > 1 && isSuffix(all[all.length - 1] as string))
    suffix.unshift(all.pop() as string)
  return { body: all, suffix }
}

export const lastName = (name: string): string => {
  const comma = commaParts(name)
  if (comma) return comma[0]
  const { body } = splitSuffix(name)
  return body[body.length - 1] ?? ''
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** The key people are ordered by: last name, then the rest; the district's override wins. */
export const sortName = (name: string, override?: string | null): string => {
  if (override && override.trim() !== '') return fold(override)
  const comma = commaParts(name)
  if (comma) return fold(`${comma[0]} ${comma[1]}`)
  const { body, suffix } = splitSuffix(name)
  const last = body.pop() ?? ''
  return fold([last, ...body, ...suffix].join(' '))
}
