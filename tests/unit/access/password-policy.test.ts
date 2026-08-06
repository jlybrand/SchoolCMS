import { describe, expect, it } from 'vitest'

import { MIN_PASSWORD_LENGTH, validatePassword } from '@/auth/password-policy'

/**
 * Password policy (interim local auth — see the deviation note in CLAUDE.md).
 *
 * This control only exists because we are storing passwords at all. Under the designed
 * Entra ID posture there are no platform passwords and this file is deleted (`02` §7).
 *
 * The rules follow NIST SP 800-63B: **length over composition**. Character-class rules
 * ("one uppercase, one symbol") measurably push people toward predictable patterns like
 * `Password1!`, which is worse than a long passphrase. That matters more than usual here,
 * because the users are school staff who log in twice a semester (`04` §2.1).
 */

const ok = 'correct horse battery staple'

/**
 * Builds a varied phrase of exactly `n` characters. Tests derive their fixtures from
 * MIN_PASSWORD_LENGTH rather than hardcoding lengths, so tuning the policy constant does
 * not break the suite — only a change in the RULES should do that.
 */
const phrase = (n: number) => 'bluehatsonrmkxvzpgw'.slice(0, n)

describe('validatePassword', () => {
  it('accepts a sufficiently long passphrase', () => {
    expect(validatePassword(ok)).toBe(true)
  })

  it('accepts exactly the minimum length', () => {
    const exact = phrase(MIN_PASSWORD_LENGTH)
    expect([...exact]).toHaveLength(MIN_PASSWORD_LENGTH)
    expect(validatePassword(exact)).toBe(true)
  })

  it('rejects one character short of the minimum, with a plain-language reason', () => {
    const result = validatePassword(phrase(MIN_PASSWORD_LENGTH - 1))
    expect(result).not.toBe(true)
    expect(String(result)).toContain(String(MIN_PASSWORD_LENGTH))
  })

  it('rejects absent or non-string values', () => {
    expect(validatePassword('')).not.toBe(true)
    expect(validatePassword(null)).not.toBe(true)
    expect(validatePassword(undefined)).not.toBe(true)
    expect(validatePassword(12345678901234 as never)).not.toBe(true)
  })

  it('does NOT impose character-class rules', () => {
    // Deliberate: NIST SP 800-63B advises against composition rules. An all-lowercase
    // passphrase is stronger than a short password with a symbol bolted on.
    expect(validatePassword('this is a long lowercase phrase')).toBe(true)
  })

  it('rejects well-known weak passwords regardless of length', () => {
    expect(validatePassword('passwordpassword')).not.toBe(true)
    expect(validatePassword('Password123456')).not.toBe(true)
    expect(validatePassword('123456789012345')).not.toBe(true)
    expect(validatePassword('qwertyqwertyqwerty')).not.toBe(true)
  })

  it('matches weak passwords case-insensitively and ignoring surrounding space', () => {
    expect(validatePassword('  PASSWORDPASSWORD  ')).not.toBe(true)
  })

  it('rejects a single repeated character however long', () => {
    expect(validatePassword('aaaaaaaaaaaaaaaaaaaaaa')).not.toBe(true)
  })

  it('rejects absurdly long input rather than hashing it', () => {
    // A cheap denial-of-service guard: never hand an unbounded string to the KDF.
    expect(validatePassword('a'.repeat(10_000))).not.toBe(true)
  })

  it('counts unicode by code point, not UTF-16 unit', () => {
    // Each emoji is 2 UTF-16 units but 1 character. A naive `.length` check would score
    // this as double its real length and wave it through.
    const short = '😀😁😂🤣😃😄😅😈😉😊😋😌'.slice(0, (MIN_PASSWORD_LENGTH - 1) * 2)
    expect([...short]).toHaveLength(MIN_PASSWORD_LENGTH - 1)
    expect(short.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH)
    expect(validatePassword(short)).not.toBe(true)

    // Enough code points AND enough variety — accepted.
    expect(validatePassword(`😀😁😂🤣${phrase(MIN_PASSWORD_LENGTH)}`)).toBe(true)
  })
})
