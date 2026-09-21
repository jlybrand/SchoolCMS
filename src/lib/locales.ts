import type { Locale } from '@/content/types'

/**
 * Locale routing (`08` §2, §5, §6).
 *
 * Scaffolded in Phase 2 with no translation behind it. The routing shape, `lang`/`dir`
 * plumbing and `hreflang` emission are structural — cheap now, expensive to retrofit across
 * a finished component library (`08` §12). The pipeline that fills these pages with
 * translated strings lands in Phase 7 and plugs in behind this without re-plumbing.
 */

/** The source locale. The only language anyone authors (`08` §2). */
export const DEFAULT_LOCALE: Locale = 'en'

/**
 * Tier 1 (`08` §2) — pre-rendered for high-traffic pages, per-locale glossary, font stack
 * tested, in the QA matrix, emergency alert templates human-verified.
 *
 * Tier 2 is any additional locale in `settings.enabledLocales`, generated on demand and
 * labelled as machine translation. Adding one is configuration, not a build change, which
 * is what makes "as many as possible" affordable.
 */
export const TIER_1_LOCALES: readonly Locale[] = ['es', 'zh-Hans', 'ko', 'pt', 'ar'] as const

/** Right-to-left scripts. Drives `dir` on `<html>` — release-blocking (`08` §6). */
export const RTL_LOCALES: readonly Locale[] = ['ar'] as const

export const ALL_LOCALES: readonly Locale[] = [DEFAULT_LOCALE, ...TIER_1_LOCALES] as const

/** Endonyms — each language named as its own speakers write it (`08` §6). */
export const LOCALE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  es: 'Español',
  'zh-Hans': '简体中文',
  ko: '한국어',
  pt: 'Português',
  ar: 'العربية',
}

/**
 * The name a locale is stored under in `settings.enabledLocales`. A field name cannot carry
 * a hyphen, so the script subtag is camel-cased — `zh-Hans` -> `zhHans` — in storage and
 * nowhere else: URLs, `lang` and `hreflang` keep the BCP 47 tag.
 */
export const localeFieldName = (locale: Locale): string =>
  locale.replace(/-([A-Za-z])/g, (_, first: string) => first.toUpperCase())

/**
 * `settings.enabledLocales` -> the locales a tenant is served in (`03` §5, `08` §2).
 *
 * The stored shape is one yes/no per platform locale (see src/collections/Settings.ts for why
 * it is checkboxes). English is always first and always present: it is the source, and the
 * unprefixed URL. The rest come back in the platform's order, so `hreflang` and the language
 * switcher are stable.
 *
 * ONLY AN EXPLICIT `false` TURNS A LANGUAGE OFF. No row, no answer, a malformed answer, and a
 * row saved before the platform gained a locale all serve it — when this is wrong it should
 * be wrong towards MORE languages, because silently dropping one is the language-access
 * failure (`08` §10) and serving an extra one is not.
 *
 * It iterates `ALL_LOCALES`, so a stored key outside it is never served. Tier 2 locales
 * arrive with the translation pipeline (Phase 7); until then one would route to a page with
 * no translation behind it.
 */
export const toEnabledLocales = (value: unknown): Locale[] => {
  const answers: Record<string, unknown> =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  return ALL_LOCALES.filter(
    (locale) => locale === DEFAULT_LOCALE || answers[localeFieldName(locale)] !== false,
  )
}

export const isRtlLocale = (locale: string): boolean => RTL_LOCALES.includes(locale)

/** `dir` for `<html>`. Total — an unknown locale degrades to `ltr`, never throws. */
export const dirFor = (locale: string): 'ltr' | 'rtl' => (isRtlLocale(locale) ? 'rtl' : 'ltr')

/**
 * Splits a locale prefix off a pathname.
 *
 * English is served UNPREFIXED. `/en/...` is deliberately not a route: two URLs for one
 * page would mean two cached artifacts, split cache-hit ratio, and a duplicate-content
 * signal — for no benefit.
 *
 * Matching is exact and case-sensitive on the script subtag (`zh-Hans`, not `zh-hans`), so
 * routing agrees with the `hreflang` values and the BCP 47 tags emitted elsewhere.
 */
export const localeFromPathname = (
  pathname: string,
  enabled: readonly Locale[] = ALL_LOCALES,
): { locale: Locale; rest: string } => {
  const candidates = enabled.filter((locale) => locale !== DEFAULT_LOCALE)
  const segments = pathname.split('/')
  const first = segments[1] ?? ''

  if (first !== '' && candidates.includes(first)) {
    const rest = `/${segments.slice(2).join('/')}`
    return { locale: first, rest: rest === '//' ? '/' : rest }
  }

  return { locale: DEFAULT_LOCALE, rest: pathname }
}

/**
 * Builds the URL for a path in a locale — the inverse of `localeFromPathname`.
 *
 * Used for the language switcher and `hreflang`. A cookie may remember the visitor's choice
 * and influence LINK GENERATION, but never the response body: one URL, one cached artifact
 * (`08` §5).
 */
export const localizedPath = (path: string, locale: Locale): string => {
  if (locale === DEFAULT_LOCALE) return path
  const normalized = path === '/' ? '' : path
  return `/${locale}${normalized}`
}
