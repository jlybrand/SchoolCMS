import { describe, expect, it } from 'vitest'

import { PLATFORM_NAME, adminBrand } from '@/admin/Brand/brand'

/**
 * The admin's branding (Jason, 2026-11-18) — PURE: the platform's name, and the district site's
 * logo (from its Settings) for the band atop the start screens.
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
    expect(adminBrand(null, 'Washington Elementary').name).toBe('Washington Elementary')
    expect(adminBrand({ logo: image }, 'Washington Elementary').logo?.alt).toBe('Dakota District 2')
  })

  it('a blank school name falls back to the platform’s', () => {
    expect(adminBrand(null, '  ').name).toBe('DDTwo Websites')
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
