import { describe, expect, it } from 'vitest'

import { normalizeHostname } from '@/lib/tenant'

/**
 * Hostname normalization for tenant resolution (`02` §4.1).
 *
 * Every request's Host maps to exactly one tenant. This runs on every public request, so it
 * must be total and boring: no throwing, no guessing, and an unusable host resolves to null
 * rather than to something.
 */

describe('normalizeHostname', () => {
  it('lowercases the host', () => {
    expect(normalizeHostname('SMS.District.ORG')).toBe('sms.district.org')
  })

  it('strips the port', () => {
    expect(normalizeHostname('sms.district.org:3000')).toBe('sms.district.org')
    expect(normalizeHostname('localhost:3000')).toBe('localhost')
  })

  it('strips a trailing dot (fully-qualified form)', () => {
    expect(normalizeHostname('sms.district.org.')).toBe('sms.district.org')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeHostname('  sms.district.org  ')).toBe('sms.district.org')
  })

  it('handles IPv6 literals without mangling them', () => {
    expect(normalizeHostname('[::1]:3000')).toBe('[::1]')
    expect(normalizeHostname('[::1]')).toBe('[::1]')
  })

  it('returns null for absent or unusable hosts — never a guess', () => {
    // An unknown host is a 404 or a redirect to the district (`02` §4.1). Resolving it to
    // a default tenant would silently serve one school's content on another's domain.
    expect(normalizeHostname(null)).toBeNull()
    expect(normalizeHostname(undefined)).toBeNull()
    expect(normalizeHostname('')).toBeNull()
    expect(normalizeHostname('   ')).toBeNull()
    expect(normalizeHostname(':3000')).toBeNull()
  })

  it('is idempotent', () => {
    const once = normalizeHostname('SMS.District.ORG:3000')
    expect(normalizeHostname(once)).toBe(once)
  })
})
