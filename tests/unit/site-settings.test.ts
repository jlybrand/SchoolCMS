import { describe, expect, it } from 'vitest'

import { toSiteSettings } from '@/content/site-settings'
import { ALL_LOCALES } from '@/lib/locales'

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
          address: '123 Main Street\n  Summerville, SC 29483  \n\n',
          phone: '(843) 555-0100',
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
      // English first, then the platform's own order.
      enabledLocales: ['en', 'es', 'ar'],
    })
  })

  it('gives a tenant with no row the defaults — never null', () => {
    for (const doc of [undefined, null, 'settings', []]) {
      expect(toSiteSettings(doc)).toEqual({
        siteTitle: null,
        contact: { address: [], phone: null, email: null },
        social: [],
        defaultDescription: null,
        enabledLocales: [...ALL_LOCALES],
      })
    }
  })

  it('drops a malformed contact value and keeps its neighbours', () => {
    const { contact } = toSiteSettings({
      contact: { address: 42, phone: 'call the office', email: 'office@dd2.example' },
    })

    expect(contact).toEqual({
      address: [],
      phone: null,
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

  describe('enabledLocales (`08` §2)', () => {
    const enabled = (value: unknown) => toSiteSettings({ enabledLocales: value }).enabledLocales

    it('English is always on — it is the source, and the only language anyone authors', () => {
      expect(enabled({ es: true, zhHans: false, ko: false, pt: false, ar: false })).toEqual([
        'en',
        'es',
      ])
      expect(
        enabled({ en: false, es: true, zhHans: false, ko: false, pt: false, ar: false }),
      ).toEqual(['en', 'es'])
    })

    it('every box unticked is a decision: English only', () => {
      expect(enabled({ es: false, zhHans: false, ko: false, pt: false, ar: false })).toEqual(['en'])
    })

    it('only an explicit NO turns a language off', () => {
      // Failing towards MORE languages: dropping one by accident is the language-access
      // failure (`08` §10); serving one nobody asked for is not. So a row that never
      // answered — or that predates a locale the platform added since — serves it.
      expect(enabled(undefined)).toEqual([...ALL_LOCALES])
      expect(enabled(null)).toEqual([...ALL_LOCALES])
      expect(enabled(['es'])).toEqual([...ALL_LOCALES])
      expect(enabled({ ar: false })).toEqual(['en', 'es', 'zh-Hans', 'ko', 'pt'])
      expect(enabled({ ar: null, ko: 'no', pt: 0 })).toEqual([...ALL_LOCALES])
    })

    it('ignores a key that is not a platform locale — it would route to an empty shell', () => {
      expect(enabled({ tlh: true, es: false })).toEqual(['en', 'zh-Hans', 'ko', 'pt', 'ar'])
    })

    it('reads zh-Hans from the field that stores it', () => {
      // A field name cannot carry the hyphen, so the script subtag is camel-cased in storage
      // and nowhere else (`localeFieldName`).
      expect(enabled({ zhHans: false })).not.toContain('zh-Hans')
      expect(enabled({ 'zh-Hans': false })).toContain('zh-Hans')
    })
  })
})
