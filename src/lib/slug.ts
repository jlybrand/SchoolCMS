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

import { PERMALINK_SEGMENT } from './permalink'

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
 * The slug of a tenant's front page.
 *
 * `/` resolves to the top-level page with this slug; `/home` deliberately resolves to
 * nothing, so the front page has exactly one URL rather than two competing for one CDN cache
 * entry (`02` §5).
 *
 * DELIBERATELY NOT IN `RESERVED_SLUGS`. The mechanism IS an ordinary page with this slug, so
 * reserving it would make the front page uncreatable. That list is for slugs colliding with a
 * platform ROUTE, which is a different problem.
 *
 * Only a TOP-LEVEL `home` is the front page. A page called "Home" nested under another page
 * is an ordinary page at an ordinary path.
 */
export const ROOT_SLUG = 'home'

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

/**
 * `base`, or `base-2`, `base-3`… — the lowest that `taken` does not hold (`posts`: a title
 * repeats every year, and the first post's URL must not move). The number survives the length
 * limit; the base is what gives way.
 */
export const nextFreeSlug = (base: string, taken: readonly string[]): string => {
  const held = new Set(taken)
  if (!held.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!held.has(candidate)) return candidate
  }
}

/**
 * Slugs reserved at the TOP of a site only. `/news` is the site's announcement list and
 * `/news/{slug}` an announcement (Jason, 2026-10-28); `/about/news` is an ordinary page.
 * `/dd2/pages/{id}` is a page's permalink (Jason, 2026-10-29).
 */
const RESERVED_TOP_LEVEL_SLUGS: readonly string[] = ['news', PERMALINK_SEGMENT] as const

/** True when a top-level page could not take this slug. */
export const isReservedTopLevelSlug = (slug: string | null | undefined): boolean => {
  if (slug === null || slug === undefined) return false
  return (
    isReservedSlug(slug) || RESERVED_TOP_LEVEL_SLUGS.includes(String(slug).trim().toLowerCase())
  )
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

  if (clean.length === 0) return '/'

  /**
   * A LONE root slug is the front page, at `/`.
   *
   * Only the lone case. Stripping a LEADING `home` from a deeper chain would turn
   * `['home', 'about']` into `/about`, colliding with a real top-level `about` — two pages at
   * one path, resolved non-deterministically and then cached. A page nested under the front
   * page genuinely has no reachable URL; `listPagePaths` skips it, and leaving its path
   * visibly wrong here is better than quietly making it look right.
   */
  if (clean.length === 1 && clean[0] === ROOT_SLUG) return '/'

  return `/${clean.join('/')}`
}

/** Inverse of `buildPagePath`. Tolerant of leading, trailing and repeated slashes. */
export const splitPagePath = (path: string | null | undefined): string[] => {
  if (path === null || path === undefined) return []
  return String(path)
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}
