import { describe, expect, it } from 'vitest'

import { toSiteSettings } from '@/content/site-settings'

/**
 * The settings mapper (`03` §5, `02` §11).
 *
 * The single point where a Payload `settings` row becomes DD2 site settings. Handed
 * `unknown` and never throws, for the reason `toNavigation` gives: this renders on every page
 * of a tenant, so a malformed value costs that value, never the footer.
 */

describe('toSiteSettings', () => {
  it('maps a complete row', () => {
    expect(
      toSiteSettings({
        siteTitle: ' Summerville Elementary School ',
        contact: {
          street: ' 123 Main Street ',
          city: 'Summerville',
          state: 'sc',
          zip: '29483',
          phone: '(843) 555-0100',
          fax: '(843) 555-0101',
          email: 'office@dd2.example',
        },
        socialLinks: [
          { id: 's1', platform: 'facebook', url: 'https://www.facebook.com/dd2schools' },
          { id: 's2', platform: 'youtube', url: 'https://www.youtube.com/@dd2schools' },
        ],
        defaultDescription: ' A K–5 school in Summerville. ',
        enabledLocales: { es: true, zhHans: false, ko: false, pt: false, ar: true },
      }),
    ).toEqual({
      siteTitle: 'Summerville Elementary School',
      contact: {
        address: ['123 Main Street', 'Summerville, SC 29483'],
        phone: { text: '(843) 555-0100', href: 'tel:8435550100' },
        fax: '(843) 555-0101',
        email: { text: 'office@dd2.example', href: 'mailto:office@dd2.example' },
      },
      social: [
        {
          id: 's1',
          platform: 'facebook',
          label: 'Facebook',
          href: 'https://www.facebook.com/dd2schools',
        },
        {
          id: 's2',
          platform: 'youtube',
          label: 'YouTube',
          href: 'https://www.youtube.com/@dd2schools',
        },
      ],
      defaultDescription: 'A K–5 school in Summerville.',
      // English only until languages are handled another way (Jason, 2026-11-18) — whatever
      // the row's old checkboxes say.
      enabledLocales: ['en'],
      logo: null,
      secondaryLogo: null,
      primaryThumbnail: null,
      secondaryThumbnail: null,
    })
  })

  it('gives a tenant with no row the defaults — never null', () => {
    for (const doc of [undefined, null, 'settings', []]) {
      expect(toSiteSettings(doc)).toEqual({
        siteTitle: null,
        contact: { address: [], phone: null, fax: null, email: null },
        social: [],
        defaultDescription: null,
        enabledLocales: ['en'],
        logo: null,
        secondaryLogo: null,
        primaryThumbnail: null,
        secondaryThumbnail: null,
      })
    }
  })

  it('drops a malformed contact value and keeps its neighbours', () => {
    const { contact } = toSiteSettings({
      contact: {
        street: 42,
        state: 'South Carolina',
        zip: 'zip',
        phone: 'call the office',
        fax: 'no fax',
        email: 'office@dd2.example',
      },
    })

    expect(contact).toEqual({
      address: [],
      phone: null,
      fax: null,
      email: { text: 'office@dd2.example', href: 'mailto:office@dd2.example' },
    })
  })

  it('drops a social link with an unknown platform or an unsafe address, and keeps the rest', () => {
    const { social } = toSiteSettings({
      socialLinks: [
        { platform: 'myspace', url: 'https://myspace.com/dd2' },
        { platform: 'facebook', url: 'javascript:alert(1)' },
        { platform: 'instagram', url: 'http://instagram.com/dd2' },
        'not a row',
        { platform: 'x', url: 'https://x.com/dd2schools' },
      ],
    })

    expect(social).toEqual([
      // A positional fallback id, as `toNavigation` gives a row without one.
      { id: 'social-4', platform: 'x', label: 'X', href: 'https://x.com/dd2schools' },
    ])
  })

  describe('the address, from its parts (Jason, 2026-11-18)', () => {
    const address = (contact: unknown) => toSiteSettings({ contact }).contact.address

    it('the street, then "City, ST zip"', () => {
      expect(
        address({ street: '1 Elm St', city: 'Summerville', state: 'SC', zip: '29483' }),
      ).toEqual(['1 Elm St', 'Summerville, SC 29483'])
    })

    it('a missing part leaves a tidy line', () => {
      expect(address({ city: 'Summerville', state: 'SC' })).toEqual(['Summerville, SC'])
      expect(address({ street: '1 Elm St', zip: '29483' })).toEqual(['1 Elm St', '29483'])
      expect(address({ city: 'Summerville' })).toEqual(['Summerville'])
    })

    it('a row saved before the split: its one-box address, line by line', () => {
      expect(address({ address: '123 Main Street\n  Summerville, SC 29483  \n\n' })).toEqual([
        '123 Main Street',
        'Summerville, SC 29483',
      ])
    })

    it('the parts win over the old box once any is filled', () => {
      expect(address({ address: 'Old Road', street: 'New Road' })).toEqual(['New Road'])
    })
  })

  describe('the images', () => {
    const image = {
      id: 9,
      kind: 'image',
      url: '/api/resources/file/logo.png',
      alt: 'School A',
      width: 200,
      height: 80,
    }

    it('each a library image, its alt text the library’s', () => {
      const settings = toSiteSettings({
        logo: image,
        secondaryLogo: { ...image, isDecorative: true },
        primaryThumbnail: image,
        secondaryThumbnail: 9,
      })
      expect(settings.logo).toMatchObject({ src: '/api/resources/file/logo.png', alt: 'School A' })
      expect(settings.secondaryLogo?.alt).toBe('')
      expect(settings.primaryThumbnail).toMatchObject({ width: 200, height: 80 })
      // An unpopulated id is no image.
      expect(settings.secondaryThumbnail).toBeNull()
    })
  })

  it('languages: English only, until they are handled another way (Jason, 2026-11-18)', () => {
    for (const enabledLocales of [undefined, { es: true, ar: true }, { es: false }]) {
      expect(toSiteSettings({ enabledLocales }).enabledLocales).toEqual(['en'])
    }
  })
})
