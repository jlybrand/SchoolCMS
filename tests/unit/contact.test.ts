import { describe, expect, it } from 'vitest'

import { toEmailHref, toPhoneHref, toSocialHref, toStateCode, toZipCode } from '@/lib/contact'

/**
 * Contact destinations (`03` §5).
 *
 * A phone number and an email address are typed the way a person writes them —
 * "(843) 555-0100" — and rendered as links. These turn what was typed into an href, or
 * refuse it. Pure, because they run twice: as field validators in the admin, and again in the
 * content mapper, which does not trust that the validators ran (as `src/lib/href.ts`).
 */

describe('toPhoneHref', () => {
  it('builds a tel: link from a number typed the way people type them', () => {
    expect(toPhoneHref('(843) 555-0100')).toBe('tel:8435550100')
    expect(toPhoneHref('843.555.0100')).toBe('tel:8435550100')
    expect(toPhoneHref(' 843-555-0100 ')).toBe('tel:8435550100')
  })

  it('keeps a leading + and nothing else that is not a digit', () => {
    expect(toPhoneHref('+1 843 555 0100')).toBe('tel:+18435550100')
  })

  it('refuses anything that is not a phone number', () => {
    for (const value of [
      '',
      '   ',
      'call us',
      '555',
      '1'.repeat(16),
      '843-555-0100 ext. 4',
      null,
      8435550100,
    ]) {
      expect(toPhoneHref(value)).toBeNull()
    }
  })
})

describe('toEmailHref', () => {
  it('builds a mailto: link', () => {
    expect(toEmailHref(' office@dd2.example ')).toBe('mailto:office@dd2.example')
  })

  it('refuses anything that is not one address', () => {
    for (const value of [
      '',
      'office',
      'office@',
      '@dd2.example',
      'office@dd2',
      'a@b.example, c@d.example',
      'office@dd2.example?subject=hi',
      'office @dd2.example',
      null,
    ]) {
      expect(toEmailHref(value)).toBeNull()
    }
  })
})

describe('toSocialHref', () => {
  it('accepts an https address', () => {
    expect(toSocialHref(' https://www.facebook.com/dd2schools ')).toBe(
      'https://www.facebook.com/dd2schools',
    )
  })

  it('refuses every other shape — a profile is never a path, a mailto or plain http', () => {
    for (const value of [
      '',
      '/facebook',
      'http://www.facebook.com/dd2schools',
      'facebook.com/dd2schools',
      'mailto:office@dd2.example',
      'javascript:alert(1)',
      'https://',
      'https://exa mple.com',
      null,
    ]) {
      expect(toSocialHref(value)).toBeNull()
    }
  })
})

describe('toStateCode — the two-letter code, as on an envelope (Jason, 2026-11-18)', () => {
  it('takes a code in any case, with spaces around it', () => {
    expect(toStateCode('SC')).toBe('SC')
    expect(toStateCode(' sc ')).toBe('SC')
  })

  it('refuses anything else', () => {
    for (const value of ['', 'S', 'SCA', 'South Carolina', 'S1', null, 29]) {
      expect(toStateCode(value)).toBeNull()
    }
  })
})

describe('toZipCode — five digits, or ZIP+4', () => {
  it('takes either, trimmed', () => {
    expect(toZipCode('29483')).toBe('29483')
    expect(toZipCode(' 29483-1234 ')).toBe('29483-1234')
  })

  it('refuses anything else', () => {
    for (const value of ['', '2948', '294831', '29483-12', '29483 1234', 'zip', null, 29483]) {
      expect(toZipCode(value)).toBeNull()
    }
  })
})
