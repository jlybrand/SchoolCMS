import { describe, expect, it } from 'vitest'

import { isSitePath, toSafeHref, validateHref } from '@/lib/href'

/**
 * Menu destinations (`03` §5, `navigation`).
 *
 * A menu link renders on every page of a tenant, so a bad one is the widest-reaching bad
 * link the platform can hold. The rule is an ALLOWLIST of shapes, not a blocklist of known
 * bad schemes — `javascript:` has too many spellings for a blocklist to be the guarantee.
 */

describe('toSafeHref', () => {
  it.each([
    ['/', '/'],
    ['/about', '/about'],
    ['/about/staff', '/about/staff'],
    ['/calendar?month=9#week-2', '/calendar?month=9#week-2'],
    ['https://forms.office.com/r/abc', 'https://forms.office.com/r/abc'],
    ['http://example.org', 'http://example.org'],
    ['HTTPS://EXAMPLE.ORG/Path', 'HTTPS://EXAMPLE.ORG/Path'],
    ['mailto:office@dd2.example', 'mailto:office@dd2.example'],
    ['tel:+18435550100', 'tel:+18435550100'],
  ])('accepts %s', (input, expected) => {
    expect(toSafeHref(input)).toBe(expected)
  })

  it('trims surrounding whitespace — a pasted address usually carries some', () => {
    expect(toSafeHref('  /about \n')).toBe('/about')
  })

  it.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    [' javascript:alert(1)'],
    ['java\tscript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['ftp://example.org/file'],
    // Protocol-relative: reads like a site path, leaves the site.
    ['//evil.example/about'],
    // Browsers normalize a backslash to a slash, so this is the same thing again.
    ['/\\evil.example'],
    // Relative: resolves differently on every page the menu renders on.
    ['about'],
    ['./about'],
    ['../about'],
    ['#main'],
    // An authority with nothing in it.
    ['https://'],
    ['mailto:'],
    ['tel:'],
    ['/about us'],
    ['/about\nus'],
    [''],
    ['   '],
  ])('refuses %j', (input) => {
    expect(toSafeHref(input)).toBeNull()
  })

  it.each([[null], [undefined], [42], [{}], [['/about']]])('refuses the non-string %j', (input) => {
    expect(toSafeHref(input)).toBeNull()
  })
})

describe('isSitePath', () => {
  it('is true only for a path on this site — the ones that take a locale prefix', () => {
    expect(isSitePath('/')).toBe(true)
    expect(isSitePath('/about/staff')).toBe(true)
    expect(isSitePath('https://example.org/about')).toBe(false)
    expect(isSitePath('mailto:office@dd2.example')).toBe(false)
    expect(isSitePath('//evil.example')).toBe(false)
  })
})

/**
 * The admin half of the same rule, shared by every field that takes a destination — menus,
 * calls to action and cards — so an editor sees the same sentence wherever they type one.
 */
describe('validateHref', () => {
  it('accepts any of the four shapes', () => {
    expect(validateHref('/about', { required: true })).toBe(true)
    expect(validateHref('tel:+18435550100', { required: false })).toBe(true)
  })

  it('refuses an unsafe destination whether or not the field is required', () => {
    expect(validateHref('javascript:alert(1)', { required: true })).toEqual(expect.any(String))
    expect(validateHref('javascript:alert(1)', { required: false })).toEqual(expect.any(String))
  })

  /**
   * A custom `validate` REPLACES Payload's built-in one, `required` check included — so the
   * validator has to own emptiness itself, in both directions.
   */
  it.each([[''], ['   '], [null], [undefined]])('treats %j as missing', (value) => {
    expect(validateHref(value, { required: true })).toEqual(expect.any(String))
    expect(validateHref(value, { required: false })).toBe(true)
  })

  it('tells the editor what to type, not what went wrong', () => {
    expect(validateHref('about', { required: true })).toMatch(/starts with \//)
  })
})
