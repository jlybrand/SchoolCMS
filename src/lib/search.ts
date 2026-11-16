/**
 * Site search's PURE parts (Jason, 2026-11-16; Phase 6 D). The query itself is
 * `src/content/search.ts`; these are what it asks before and after.
 */

/** A search box is for words, not documents. Longer is cut. */
export const MAX_QUERY_LENGTH = 200

/**
 * Postgres marks each match in a snippet with these (`ts_headline`'s StartSel / StopSel). Control
 * characters, so no text a person wrote can contain them — `normalizeQuery` strips them from the
 * query, and `toSearchEntry`'s text never holds them.
 */
export const MATCH_START = '\u0001'
export const MATCH_END = '\u0002'

const CONTROL = /[\u0000-\u001f\u007f]/g

/** What a visitor typed, ready to search: trimmed, one space between words, capped. None: null. */
export const normalizeQuery = (raw: unknown): string | null => {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const query = value.replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH)
  return query === '' ? null : query
}

export type SnippetPart = { text: string; match: boolean }

/** A highlighted snippet as parts: a component renders the matches in `<mark>`, as text. */
export const splitSnippet = (snippet: string): SnippetPart[] => {
  const parts: SnippetPart[] = []
  const flat = snippet.replace(/\s+/g, ' ')
  let rest = flat
  while (rest !== '') {
    const start = rest.indexOf(MATCH_START)
    if (start === -1) {
      parts.push({ text: rest, match: false })
      break
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), match: false })
    const end = rest.indexOf(MATCH_END, start + 1)
    const stop = end === -1 ? rest.length : end
    const word = rest.slice(start + 1, stop)
    if (word !== '') parts.push({ text: word, match: true })
    rest = end === -1 ? '' : rest.slice(end + 1)
  }
  return parts.filter((p) => p.text !== '')
}
