import { describe, expect, it } from 'vitest'

import { PLATFORM_NAME, adminBrand } from '@/admin/Brand/brand'

/**
 * The admin's branding (Jason, 2026-11-18) — PURE: the platform's name, and the district site's
 * logo (from its Settings) for the band atop the start screens. A school manager's band is their
 * school's: its name, its logo, its two colors on the underline (Jason, 2026-11-19).
 */

const image = {
  id: 7,
  kind: 'image',
  url: '/api/resources/file/district-logo.png',
  width: 400,
  height: 120,
  alt: 'Dakota District 2',
}

describe('adminBrand', () => {
  it('the platform is DDTwo Websites', () => {
    expect(PLATFORM_NAME).toBe('DDTwo Websites')
    expect(adminBrand(null).name).toBe('DDTwo Websites')
  })

  it('a school’s start screen says the school’s name instead (Jason, 2026-11-18)', () => {
    expect(adminBrand(null, { name: 'Washington Elementary' }).name).toBe('Washington Elementary')
  })

  it('a blank school name falls back to the platform’s', () => {
    expect(adminBrand(null, { name: '  ' }).name).toBe('DDTwo Websites')
  })

  it('a school’s band shows the school’s own logo (Jason, 2026-11-19)', () => {
    const own = { ...image, id: 9, url: '/api/resources/file/wes.png', alt: 'Washington Eagles' }
    const brand = adminBrand(
      { logo: image },
      { name: 'Washington Elementary', settings: { logo: own } },
    )
    expect(brand.logo).toMatchObject({
      src: '/api/resources/file/wes.png',
      alt: 'Washington Eagles',
    })
  })

  it('a school with no logo of its own shows the district’s', () => {
    for (const settings of [undefined, null, { logo: null }, { logo: 9 }])
      expect(
        adminBrand({ logo: image }, { name: 'Washington Elementary', settings }).logo?.alt,
      ).toBe('Dakota District 2')
  })

  it('the district’s band keeps the district’s underline', () => {
    expect(adminBrand({ logo: image }).rule).toBeNull()
  })

  it('a school’s underline is in its two colors (Jason, 2026-11-19)', () => {
    expect(
      adminBrand(null, {
        name: 'Washington Elementary',
        theme: { primaryColor: '#14532D', secondaryColor: '#fc0' },
      }).rule,
    ).toEqual({ primary: '#14532d', secondary: '#ffcc00' })
  })

  it('a color left empty is what the school’s site shows: district navy, a plain grey line', () => {
    for (const theme of [undefined, null, {}, { primaryColor: null, secondaryColor: '' }])
      expect(adminBrand(null, { name: 'Washington Elementary', theme }).rule).toEqual({
        primary: '#2b3170',
        secondary: '#d3d7de',
      })
  })

  it('a stored value that is not a color never reaches the page', () => {
    expect(
      adminBrand(null, {
        name: 'Washington Elementary',
        theme: { primaryColor: 'red; background: url(x)', secondaryColor: 'javascript:1' },
      }).rule,
    ).toEqual({ primary: '#2b3170', secondary: '#d3d7de' })
  })

  it('the district’s logo, its alt text the library’s', () => {
    expect(adminBrand({ logo: image }).logo).toMatchObject({
      src: '/api/resources/file/district-logo.png',
      alt: 'Dakota District 2',
      width: 400,
      height: 120,
    })
  })

  it('a decorative logo has empty alt: the band’s name says it', () => {
    expect(adminBrand({ logo: { ...image, isDecorative: true } }).logo?.alt).toBe('')
  })

  it('no settings, no logo, an unpopulated id, or a document: no logo', () => {
    expect(adminBrand(null).logo).toBeNull()
    expect(adminBrand({ logo: null }).logo).toBeNull()
    expect(adminBrand({ logo: 7 }).logo).toBeNull()
    expect(adminBrand({ logo: { ...image, kind: 'document' } }).logo).toBeNull()
  })
})
