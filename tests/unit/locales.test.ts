import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LOCALE,
  dirFor,
  isRtlLocale,
  localeFromPathname,
  localizedPath,
  RTL_LOCALES,
  TIER_1_LOCALES,
} from '@/lib/locales'

/**
 * Locale routing (`08` §5, §6).
 *
 * Scaffolded in Phase 2 with NO translation behind it, deliberately: the routing shape,
 * `lang`/`dir` plumbing and `hreflang` emission are structural, and retrofitting them
 * across a finished component library is expensive (`05` Phase 2, `08` §12).
 *
 * `lang` on `<html>` is WCAG 3.1.1 and `dir="rtl"` for Arabic is release-blocking
 * (`08` §6), so these are accessibility functions, not formatting helpers.
 */

describe('locale tiers', () => {
  it('treats English as the source locale — the only language anyone authors', () => {
    expect(DEFAULT_LOCALE).toBe('en')
  })

  it('carries the five Tier 1 locales from `08` §2', () => {
    expect(TIER_1_LOCALES).toEqual(['es', 'zh-Hans', 'ko', 'pt', 'ar'])
  })

  it('marks Arabic as RTL', () => {
    expect(RTL_LOCALES).toContain('ar')
  })
})

describe('localeFromPathname', () => {
  it('returns the default locale for an unprefixed path — English is served at the root', () => {
    expect(localeFromPathname('/')).toEqual({ locale: 'en', rest: '/' })
    expect(localeFromPathname('/athletics')).toEqual({ locale: 'en', rest: '/athletics' })
  })

  it('extracts a known locale prefix and strips it', () => {
    expect(localeFromPathname('/es')).toEqual({ locale: 'es', rest: '/' })
    expect(localeFromPathname('/es/')).toEqual({ locale: 'es', rest: '/' })
    expect(localeFromPathname('/es/athletics')).toEqual({ locale: 'es', rest: '/athletics' })
    expect(localeFromPathname('/ar/calendar/2026')).toEqual({
      locale: 'ar',
      rest: '/calendar/2026',
    })
  })

  it('handles a script-tagged locale', () => {
    expect(localeFromPathname('/zh-Hans/news')).toEqual({ locale: 'zh-Hans', rest: '/news' })
  })

  it('does NOT treat an unknown prefix as a locale', () => {
    // `/en/...` is deliberately not a locale route — English lives at the root, so one
    // page never has two cacheable URLs.
    expect(localeFromPathname('/en/athletics')).toEqual({ locale: 'en', rest: '/en/athletics' })
    expect(localeFromPathname('/staff/directory')).toEqual({
      locale: 'en',
      rest: '/staff/directory',
    })
    expect(localeFromPathname('/eshop')).toEqual({ locale: 'en', rest: '/eshop' })
  })

  it('is case-sensitive on the script subtag, matching BCP 47 routing', () => {
    expect(localeFromPathname('/zh-hans/news').locale).toBe('en')
  })

  it('restricts to the enabled set when one is supplied', () => {
    // `settings.enabledLocales` is per-tenant configuration (`03` §5). A locale that is
    // not enabled must not resolve, or it would render an empty shell on a real URL.
    const enabled = ['es'] as const
    expect(localeFromPathname('/es/news', enabled).locale).toBe('es')
    expect(localeFromPathname('/ar/news', enabled)).toEqual({ locale: 'en', rest: '/ar/news' })
  })
})

describe('dirFor / isRtlLocale', () => {
  it('returns rtl only for RTL locales', () => {
    expect(dirFor('ar')).toBe('rtl')
    expect(isRtlLocale('ar')).toBe(true)
  })

  it('returns ltr for everything else', () => {
    for (const locale of ['en', 'es', 'zh-Hans', 'ko', 'pt']) {
      expect(dirFor(locale)).toBe('ltr')
      expect(isRtlLocale(locale)).toBe(false)
    }
  })

  it('defaults to ltr for an unknown locale rather than throwing', () => {
    // Total function: a bad locale must degrade to a readable page, not a 500.
    expect(dirFor('xx')).toBe('ltr')
    expect(dirFor('')).toBe('ltr')
  })
})

describe('localizedPath', () => {
  it('leaves English unprefixed', () => {
    expect(localizedPath('/athletics', 'en')).toBe('/athletics')
    expect(localizedPath('/', 'en')).toBe('/')
  })

  it('prefixes every other locale', () => {
    expect(localizedPath('/athletics', 'es')).toBe('/es/athletics')
    expect(localizedPath('/', 'ar')).toBe('/ar')
  })

  it('round-trips with localeFromPathname', () => {
    // The property that keeps link generation and routing from drifting apart.
    for (const locale of [DEFAULT_LOCALE, ...TIER_1_LOCALES]) {
      for (const path of ['/', '/athletics', '/calendar/2026']) {
        const built = localizedPath(path, locale)
        expect(localeFromPathname(built)).toEqual({ locale, rest: path })
      }
    }
  })
})
