import type { Locale, RichText, RichTextInline } from '@/content/types'

import { DEFAULT_LOCALE, localizedPath } from './locales'

/**
 * SEO/OG assembly, the sitemap and robots (`01` §3 item 13, `08` §5).
 *
 * Pure. The route files call these with what `src/content/*` returned and hand the result to
 * Next; nothing here knows about Next, Payload or the request. Everything it produces is read
 * by machines — crawlers and link previews — which parse bytes, resolve nothing, and forgive
 * nothing, so URLs are absolute and output is exact.
 */

/**
 * The origin a tenant is served from.
 *
 * Derived from the tenant's own hostname, never from the request: these run at build and
 * revalidate time (`02` §5), where there is no request, and a canonical URL taken from a
 * `Host` header is one a visitor can choose. `localhost` and `*.localhost` are the only hosts
 * served without a certificate.
 */
export const siteOrigin = (hostname: string): string => {
  const local = hostname === 'localhost' || hostname.endsWith('.localhost')
  return `${local ? 'http' : 'https'}://${hostname}`
}

/** `/` stays `/`; every other path is appended as-is. Localized first, so `/es` has no slash. */
const absoluteUrl = (origin: string, path: string, locale: Locale): string =>
  `${origin}${localizedPath(path, locale)}`

/**
 * Whether search engines may index this environment.
 *
 * FAILS CLOSED. Staging mirrors production with pilot data (`09` §1), and a staging site in
 * a search index is a second copy of a school's website with the wrong content on it. An
 * unset variable is how every new environment starts, so only the exact value `allow` opens
 * the door — production sets it; nothing else does.
 */
export const indexingAllowed = (env: Record<string, string | undefined>): boolean =>
  env.SITE_INDEXING === 'allow'

const inlineText = (nodes: readonly RichTextInline[]): string =>
  nodes
    .map((node) =>
      node.kind === 'link' ? node.children.map((child) => child.text).join('') : node.text,
    )
    .join('')

/** Long enough to say something; short enough that a results page shows all of it. */
const DESCRIPTION_LENGTH = 160

/**
 * The first paragraph of a body, as plain text, or null.
 *
 * The fallback description. School managers log in a few times a year (`04` §2.1) and will
 * not write one, so the page has to describe itself. Headings are skipped — "Welcome"
 * describes nothing — and so are lists, which read as fragments out of context. No prose
 * means null rather than the title again: a search engine writes a better description than
 * one that repeats what is already above it.
 */
export const excerptOf = (body: RichText, max: number = DESCRIPTION_LENGTH): string | null => {
  for (const block of body) {
    if (block.kind !== 'paragraph') continue

    const text = inlineText(block.children).replace(/\s+/g, ' ').trim()
    if (text === '') continue
    if (text.length <= max) return text

    // Room for the ellipsis, then back to the last whole word.
    const head = text.slice(0, max - 1)
    const lastSpace = head.lastIndexOf(' ')
    return `${(lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd()}…`
  }

  return null
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

export type PageMetadataInput = {
  readonly tenant: { readonly name: string; readonly hostname: string }
  readonly page: {
    readonly title: string
    readonly path: string
    readonly body: RichText
    readonly seo: { readonly title: string | null; readonly description: string | null }
    /** Absent is false — a page is listed unless someone chose otherwise. */
    readonly hideFromSearchEngines?: boolean
    /** A reuse page's district original (Jason, 2026-10-29) — the canonical. */
    readonly reusedFrom?: { readonly path: string; readonly hostname: string } | null
  }
  readonly locale: Locale
  /** Every locale this page is served in (`08` §5). */
  readonly locales: readonly Locale[]
  readonly indexable: boolean
  /** `settings.defaultDescription` (`03` §5) — the last resort, see `buildPageMetadata`. */
  readonly defaultDescription?: string | null
}

/** Structurally a subset of Next's `Metadata`, so the route returns it as-is. */
export type PageMetadata = {
  title: string
  description?: string
  alternates: { canonical: string; languages: Record<string, string> }
  openGraph: {
    type: 'website'
    title: string
    description?: string
    url: string
    siteName: string
    locale: Locale
  }
  robots: { index: boolean; follow: boolean }
}

const SEPARATOR = ' — '

/**
 * The document title.
 *
 * THE SITE NAME IS NOT THE EDITOR'S TO DROP. An SEO title replaces the page part; the suffix
 * stays, so 28 sites title their pages one way and a search result always says whose page it
 * is. The front page is the exception in one direction only: with no SEO title it is the site
 * name alone, because its `title` field is an editor's label for the row ("Home"), not the
 * name of anything (`03` §2).
 */
const titleFor = ({ tenant, page }: PageMetadataInput): string => {
  const custom = clean(page.seo.title)

  if (custom === null) {
    return page.path === '/' ? tenant.name : `${page.title}${SEPARATOR}${tenant.name}`
  }

  // An editor who typed the site name themselves meant the same thing; do not say it twice.
  return custom.endsWith(tenant.name) ? custom : `${custom}${SEPARATOR}${tenant.name}`
}

export const buildPageMetadata = (input: PageMetadataInput): PageMetadata => {
  const { tenant, page, locale, locales, indexable } = input

  const origin = siteOrigin(tenant.hostname)
  const title = titleFor(input)
  /**
   * The site's description comes LAST. It is the same sentence on every page that uses it,
   * which is a duplicate-description signal, so a page's own first paragraph outranks it and
   * it is left for the page with nothing of its own to say.
   */
  const description =
    clean(page.seo.description) ?? excerptOf(page.body) ?? clean(input.defaultDescription)
  const url = absoluteUrl(origin, page.path, locale)
  /**
   * The canonical and the language alternates name the ORIGINAL: for a reuse page that is the
   * district page it shows, so the two copies do not compete in results. Open Graph keeps `url`,
   * the address the visitor is actually on.
   */
  const original = page.reusedFrom
    ? { origin: siteOrigin(page.reusedFrom.hostname), path: page.reusedFrom.path }
    : { origin, path: page.path }

  return {
    title,
    // Omitted, never empty: `exactOptionalPropertyTypes`, and an empty tag is noise.
    ...(description === null ? {} : { description }),
    alternates: {
      canonical: absoluteUrl(original.origin, original.path, locale),
      // `08` §5 — an alternate for every enabled locale, plus x-default on the English URL.
      languages: {
        ...Object.fromEntries(
          locales.map((code) => [code, absoluteUrl(original.origin, original.path, code)]),
        ),
        'x-default': absoluteUrl(original.origin, original.path, DEFAULT_LOCALE),
      },
    },
    openGraph: {
      type: 'website',
      title,
      ...(description === null ? {} : { description }),
      url,
      siteName: tenant.name,
      locale,
    },
    /**
     * Both halves off on a closed site, so it is not crawled THROUGH either (see
     * `indexingAllowed`). A page hidden from search engines (Jason, 2026-10-29) drops only the
     * first: it is not listed, but the pages it links to are still found through it.
     */
    robots: { index: indexable && page.hideFromSearchEngines !== true, follow: indexable },
  }
}

/**
 * `robots.txt`.
 *
 * `/admin` and `/api` are disallowed even when indexing is on. Neither is secret and neither
 * is protected by this — access control does that — but a crawler walking the REST API is
 * load with no reader at the end of it.
 */
export const buildRobotsTxt = ({
  origin,
  indexable,
}: {
  readonly origin: string
  readonly indexable: boolean
}): string =>
  indexable
    ? [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /api',
        '',
        `Sitemap: ${origin}/sitemap.xml`,
        '',
      ].join('\n')
    : 'User-agent: *\nDisallow: /\n'

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char)

/**
 * `sitemap.xml`, with locale variants (`08` §5).
 *
 * One `<url>` per page PER LOCALE, each carrying the full alternate set — itself included,
 * plus `x-default`. That redundancy is the format: search engines discard hreflang
 * annotations that are not reciprocal and self-referencing, so a sitemap that listed the
 * alternates once per page would be listing them for nobody.
 *
 * No `<lastmod>`. `Page` carries no modification time, and a `lastmod` that is really the
 * build time teaches a crawler to ignore the field.
 */
export const buildSitemapXml = ({
  origin,
  paths,
  locales,
}: {
  readonly origin: string
  readonly paths: readonly string[]
  readonly locales: readonly Locale[]
}): string => {
  const entries = paths.flatMap((path) => {
    const alternates = [
      ...locales.map((code) => [code, absoluteUrl(origin, path, code)] as const),
      ['x-default', absoluteUrl(origin, path, DEFAULT_LOCALE)] as const,
    ]
      .map(
        ([code, href]) =>
          `    <xhtml:link rel="alternate" hreflang="${escapeXml(code)}" href="${escapeXml(href)}"/>`,
      )
      .join('\n')

    return locales.map(
      (code) =>
        `  <url>\n    <loc>${escapeXml(absoluteUrl(origin, path, code))}</loc>\n${alternates}\n  </url>`,
    )
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')
}
