/**
 * Menu destinations (`03` §5).
 *
 * AN ALLOWLIST OF SHAPES, not a blocklist of schemes. `javascript:` survives case changes,
 * leading whitespace and embedded tabs in enough browsers that a list of things to refuse is
 * a list with a hole in it; a list of things to accept fails closed on whatever it has not
 * thought of.
 *
 * Four shapes are accepted, because four are what a school menu actually points at: a page
 * on this site, a web address (the enrollment portal, an MS Forms survey), an email address
 * and a phone number.
 *
 * Pure, so it runs in both places it matters: as the field validator in the admin, which
 * tells the editor, and in the content mapper, which does not trust that the validator ran —
 * a migration or a direct database write only has to get past the first one.
 */

/** Anything that would let a value be read differently by a browser than by this file. */
const UNSAFE_CHARACTERS = /[\s\\\u0000-\u001f\u007f]/

/** A path on this site: one leading slash, never two (`//host` leaves the site). */
const SITE_PATH = /^\/(?!\/)/

const WEB_ADDRESS = /^https?:\/\/[^/?#]+/i
const EMAIL = /^mailto:[^@]+@[^@]+$/i
const PHONE = /^tel:\+?[0-9().-]+$/i

/**
 * True for a path on this site. These are the only destinations that take a locale prefix —
 * a Spanish page's menu links to `/es/about`, and to the enrollment portal unchanged
 * (`08` §5).
 */
export const isSitePath = (href: string): boolean =>
  SITE_PATH.test(href) && !UNSAFE_CHARACTERS.test(href)

/** The trimmed destination, or null if it is not one of the four accepted shapes. */
export const toSafeHref = (value: unknown): string | null => {
  if (typeof value !== 'string') return null

  const href = value.trim()
  if (href === '' || UNSAFE_CHARACTERS.test(href)) return null

  if (SITE_PATH.test(href) || WEB_ADDRESS.test(href) || EMAIL.test(href) || PHONE.test(href)) {
    return href
  }

  return null
}
