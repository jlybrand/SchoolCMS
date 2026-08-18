/**
 * Slug generation and page-path assembly (`03` §2).
 *
 * A slug is a URL. Once a page is live it is in search indexes, in printed newsletters, and
 * in the redirect map built during migration (`10` §6), so the output of these functions is
 * an interface, not a formatting detail. They are deliberately dull and fully deterministic.
 *
 * What they never do: invent a value. `slugify` returns an empty string rather than a
 * generated fallback like `page-1`, because a synthesized slug is a URL nobody can predict,
 * redirect, or recognise as wrong. The caller decides — for `pages` that means field
 * validation refuses to save (see src/collections/Pages.ts).
 */

/** Longest slug we emit. Comfortably inside every practical URL limit, still readable. */
const MAX_SLUG_LENGTH = 80

/**
 * Slugs that would shadow a real route.
 *
 * `sites` is the edge rewrite target, which src/proxy.ts refuses on direct request; `admin`
 * and `api` are Payload's own mount point; `_next` is framework internals. A page slugged
 * into any of these is unreachable at best and route-shadowing at worst.
 */
const RESERVED_SLUGS: readonly string[] = ['sites', 'admin', 'api', '_next'] as const

/**
 * Title -> URL slug.
 *
 * Unicode NFD splits an accented character into its base letter plus a combining mark, so
 * stripping the combining range folds "é" to "e" without a hand-maintained character map.
 * Anything still outside `[a-z0-9]` afterwards becomes a separator.
 */
export const slugify = (input: string | null | undefined): string => {
  if (input === null || input === undefined) return ''

  const folded = String(input)
    .normalize('NFD')
    // Combining diacritical marks — the accents NFD just separated out.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    /**
     * Apostrophes and quotes are deleted, not separated on. They sit INSIDE a word, so
     * treating them as a separator gives "principal-s-message" — which reads as a typo and
     * is not what anyone would guess when typing the URL. Straight and curly forms both,
     * since editors paste from Word (`07` §4.2).
     */
    .replace(/['’‘`"“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')

  const trimmed = folded.replace(/^-+|-+$/g, '')
  if (trimmed.length <= MAX_SLUG_LENGTH) return trimmed

  // Truncating mid-word is acceptable; leaving a dangling separator is not.
  return trimmed.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '')
}

/** True when a slug would collide with a platform route. Compared case-insensitively. */
export const isReservedSlug = (slug: string | null | undefined): boolean => {
  if (slug === null || slug === undefined) return false
  return RESERVED_SLUGS.includes(String(slug).trim().toLowerCase())
}

/**
 * Ancestor slugs -> the page's path, root first.
 *
 * Empty segments are dropped rather than joined through, because `//about` and `/about` are
 * different URLs to the CDN and would occupy two cache entries for one page (`02` §5).
 */
export const buildPagePath = (segments: readonly (string | null | undefined)[]): string => {
  const clean = segments
    .map((segment) => (segment ?? '').trim())
    .filter((segment) => segment.length > 0)

  return clean.length === 0 ? '/' : `/${clean.join('/')}`
}

/** Inverse of `buildPagePath`. Tolerant of leading, trailing and repeated slashes. */
export const splitPagePath = (path: string | null | undefined): string[] => {
  if (path === null || path === undefined) return []
  return String(path)
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}
