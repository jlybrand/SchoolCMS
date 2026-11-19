/**
 * A link's own screen-reader words — its `aria-label` (Jason, 2026-11-19: aria-labels "probably
 * should not be stripped unless they are unnecessary").
 *
 * KEPT only when it ADDS to the link's visible words and CONTAINS them. WCAG 2.5.3 Label in Name:
 * a voice-control user says what they see, so "Read more" must still be inside "Read more about
 * the bond election". A label that only repeats the words is unnecessary; one that leaves them out
 * fails 2.5.3. Both are dropped — the caller says which.
 *
 * Pure. One rule, read in three places: the HTML view (`src/lib/html-source.ts`), the content
 * mapper (`src/content/rich-text.ts` — the renderer's guarantee, whatever is stored) and nowhere
 * else needs its own copy.
 */

export type LinkLabelVerdict = { keep: string } | { drop: 'empty' | 'repeats' | 'missing-words' }

/** Case, spacing and punctuation do not change what a person hears or says. */
const comparable = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const linkLabelVerdict = (
  label: string | null | undefined,
  words: string,
): LinkLabelVerdict => {
  const kept = (label ?? '').replace(/\s+/g, ' ').trim()
  if (kept === '') return { drop: 'empty' }

  const said = comparable(words)
  const heard = comparable(kept)
  if (said === '' || !` ${heard} `.includes(` ${said} `)) return { drop: 'missing-words' }
  if (heard === said) return { drop: 'repeats' }
  return { keep: kept }
}
