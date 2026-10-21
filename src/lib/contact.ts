import { toSafeHref } from './href'

/**
 * Contact destinations (`03` §5).
 *
 * A phone number and an email address are stored the way a person typed them, because that
 * is what the footer shows; these build the link beside the words, or return null. Same
 * posture as `src/lib/href.ts`, and for the same reason: pure, so the field validator and the
 * content mapper run one definition, and the mapper does not have to trust that the
 * validator ran.
 */

/** E.164 allows 15 digits; seven is the shortest thing anyone would call a phone number. */
const MIN_PHONE_DIGITS = 7
const MAX_PHONE_DIGITS = 15

/** What a written phone number is made of. An extension is not dialable and is refused. */
const PHONE_SHAPE = /^\+?[0-9\s().-]+$/

/** `tel:` + the digits, keeping a leading `+` — or null. */
export const toPhoneHref = (value: unknown): string | null => {
  if (typeof value !== 'string') return null

  const phone = value.trim()
  if (!PHONE_SHAPE.test(phone)) return null

  const digits = phone.replace(/\D/g, '')
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) return null

  return `tel:${phone.startsWith('+') ? '+' : ''}${digits}`
}

/**
 * One address, with nothing a `mailto:` would read as a second recipient or a header
 * (`?subject=`, `,`). Deliberately looser than RFC 5322 about what an address is and stricter
 * about what may follow it.
 */
const EMAIL_SHAPE = /^[^\s@,;?&<>"]+@[^\s@,;?&<>"]+\.[^\s@,;?&<>".]+$/

/** `mailto:` + the address — or null. */
export const toEmailHref = (value: unknown): string | null => {
  if (typeof value !== 'string') return null

  const email = value.trim()
  return EMAIL_SHAPE.test(email) ? `mailto:${email}` : null
}

/**
 * A social profile: an `https` address and nothing else. Narrower than a menu destination
 * (`toSafeHref`) on purpose — a profile is never a site path, an email or a phone number, and
 * every platform on the list serves https.
 */
export const toSocialHref = (value: unknown): string | null => {
  const href = toSafeHref(value)
  return href !== null && /^https:\/\//i.test(href) ? href : null
}
