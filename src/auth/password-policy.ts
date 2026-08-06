/**
 * Password policy for the interim local-auth posture.
 *
 * ============================================================================
 * THIS FILE EXISTS ONLY BECAUSE WE ARE STORING PASSWORDS.
 * Under the designed Entra ID posture (`02` §7, ADR-6) the platform stores no
 * credentials and this module is deleted. See the deviation note in CLAUDE.md.
 * ============================================================================
 *
 * Rules follow NIST SP 800-63B: **length over composition**. Character-class requirements
 * push people toward predictable patterns (`Password1!`) and measurably reduce entropy.
 * That matters especially here, because the users are school staff who log in a few times
 * a year and will otherwise write the password down (`04` §2.1).
 */

/**
 * 8 characters — the NIST SP 800-63B floor for user-chosen secrets.
 *
 * Worth knowing what this leans on: under the designed Entra posture, password strength is
 * one control among several (district MFA, conditional access, central policy). Under
 * interim local auth it is the only one, alongside lockout. Raising it is a one-line change
 * here and the tests derive from the constant.
 */
export const MIN_PASSWORD_LENGTH = 8

/** Never hand an unbounded string to the key-derivation function. */
export const MAX_PASSWORD_LENGTH = 256

/**
 * Obvious weak choices, checked case-insensitively as substrings.
 *
 * Deliberately short — this is a speed bump against the laziest choices, NOT a breach
 * corpus. A real breached-password check (k-anonymity against a published corpus) belongs
 * with the Entra migration, or nowhere, because Entra enforces district policy centrally.
 */
const WEAK_FRAGMENTS = [
  'password',
  '123456',
  'qwerty',
  'letmein',
  'welcome',
  'admin',
  'dd2',
  'district',
] as const

export const validatePassword = (value: unknown): true | string => {
  if (typeof value !== 'string' || value === '') {
    return 'Please enter a password.'
  }

  const trimmed = value.trim()
  // Count code points, not UTF-16 units, so emoji and astral characters count as one.
  const length = [...trimmed].length

  if (length < MIN_PASSWORD_LENGTH) {
    return `Please use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you can remember is ideal — it does not need symbols or capitals.`
  }

  if (length > MAX_PASSWORD_LENGTH) {
    return `Please use ${MAX_PASSWORD_LENGTH} characters or fewer.`
  }

  const lowered = trimmed.toLowerCase()

  if (WEAK_FRAGMENTS.some((fragment) => lowered.includes(fragment))) {
    return 'That password contains a very common word. Please choose a different phrase.'
  }

  // A single repeated character satisfies any length rule while carrying no entropy.
  if (new Set([...trimmed]).size < 5) {
    return 'Please use a more varied phrase.'
  }

  return true
}
