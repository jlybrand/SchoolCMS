import { describe, expect, it } from 'vitest'

import type { RichText } from '@/content/types'
import {
  buildPageMetadata,
  buildRobotsTxt,
  buildSitemapXml,
  excerptOf,
  indexingAllowed,
  siteOrigin,
} from '@/lib/seo'

/**
 * SEO/OG assembly, the sitemap and robots (`01` §3 item 13, `08` §5, `06` §2.1).
 *
 * Pure functions of their inputs, so test-first. Everything here is emitted for machines —
 * crawlers and link previews parse these bytes and nothing renders them — which is why the
 * assertions are on exact output.
 */

const paragraph = (text: string): RichText[number] => ({
  kind: 'paragraph',
  children: [{ kind: 'text', text, marks: [] }],
})

const tenant = { name: 'School A', hostname: 'a.dd2.example' }

const page = (overrides: Record<string, unknown> = {}) => ({
  title: 'About Our School',
  path: '/about',
  body: [paragraph('We are a K–5 school of 480 students in Summerville.')],
  seo: { title: null, description: null },
  ...overrides,
})

describe('siteOrigin', () => {
  it('is https for a real host', () => {
    expect(siteOrigin('a.dd2.example')).toBe('https://a.dd2.example')
  })

  it('is http for localhost and *.localhost — the only hosts with no certificate', () => {
    expect(siteOrigin('localhost')).toBe('http://localhost')
    expect(siteOrigin('a.localhost')).toBe('http://a.localhost')
    // Not fooled by a real host that merely ends in the letters.
    expect(siteOrigin('notlocalhost.example')).toBe('https://notlocalhost.example')
  })
})

describe('excerptOf', () => {
  it('is the first paragraph, as plain text', () => {
    const body: RichText = [
      { kind: 'heading', level: 2, children: [{ kind: 'text', text: 'Welcome', marks: [] }] },
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'Read the ', marks: [] },
          {
            kind: 'link',
            href: '/handbook',
            newTab: false,
            children: [{ kind: 'text', text: 'family handbook', marks: ['strong'] }],
          },
          { kind: 'text', text: ' before the first day.', marks: [] },
        ],
      },
      paragraph('A second paragraph that is not used.'),
    ]

    // Headings are skipped: "Welcome" describes nothing.
    expect(excerptOf(body)).toBe('Read the family handbook before the first day.')
  })

  it('cuts at a word boundary and says it was cut', () => {
    const long = 'The quick brown fox jumps over the lazy dog. '.repeat(10)
    const excerpt = excerptOf([paragraph(long)], 60)

    expect(excerpt?.length).toBeLessThanOrEqual(60)
    expect(excerpt?.endsWith('…')).toBe(true)
    expect(excerpt).not.toMatch(/\s…$/)
    // Never mid-word.
    expect(long.startsWith(excerpt!.slice(0, -1))).toBe(true)
    expect(long.charAt(excerpt!.length - 1)).toBe(' ')
  })

  it('collapses whitespace', () => {
    expect(excerptOf([paragraph('  Two\n\n lines\tand   gaps ')])).toBe('Two lines and gaps')
  })

  it('is null when there is no prose — a list-only or empty page has no honest summary', () => {
    expect(excerptOf([])).toBeNull()
    expect(excerptOf([paragraph('   ')])).toBeNull()
    expect(
      excerptOf([
        {
          kind: 'list',
          ordered: false,
          items: [{ children: [{ kind: 'text', text: 'x', marks: [] }], list: null }],
        },
      ]),
    ).toBeNull()
  })
})

describe('buildPageMetadata', () => {
  const build = (overrides: Record<string, unknown> = {}, locale = 'en', indexable = true) =>
    buildPageMetadata({
      tenant,
      page: page(overrides),
      locale,
      locales: ['en', 'es', 'ar'],
      indexable,
    })

  it('titles a page "<page> — <site>", and the front page with the site name alone', () => {
    expect(build().title).toBe('About Our School — School A')
    // "Home" is an editor's label for the row, not the name of the site (`03` §2).
    expect(build({ path: '/', title: 'Home' }).title).toBe('School A')
  })

  it('an SEO title replaces the PAGE part only — the site name is not the editor’s to drop', () => {
    expect(build({ seo: { title: 'Meet Summerville Elementary', description: null } }).title).toBe(
      'Meet Summerville Elementary — School A',
    )
    // On the front page an SEO title is used as written, with the site name kept.
    expect(build({ path: '/', seo: { title: 'Welcome', description: null } }).title).toBe(
      'Welcome — School A',
    )
  })

  it('does not double the site name when the editor typed it', () => {
    expect(build({ seo: { title: 'About — School A', description: null } }).title).toBe(
      'About — School A',
    )
  })

  it('describes the page with the SEO description, else the first paragraph, else nothing', () => {
    expect(build({ seo: { title: null, description: ' Written by a person. ' } }).description).toBe(
      'Written by a person.',
    )
    expect(build().description).toBe('We are a K–5 school of 480 students in Summerville.')
    // Never the site name or the title again: a description that describes nothing is
    // worse than none, because a search engine will write a better one itself.
    expect(build({ body: [] }).description).toBeUndefined()
  })

  it('emits ABSOLUTE canonical and hreflang URLs — a crawler has no base to resolve against', () => {
    const meta = build({}, 'es')

    expect(meta.alternates.canonical).toBe('https://a.dd2.example/es/about')
    expect(meta.alternates.languages).toEqual({
      en: 'https://a.dd2.example/about',
      es: 'https://a.dd2.example/es/about',
      ar: 'https://a.dd2.example/ar/about',
      'x-default': 'https://a.dd2.example/about',
    })
  })

  it('has no trailing slash on a localized front page', () => {
    expect(build({ path: '/' }, 'es').alternates.canonical).toBe('https://a.dd2.example/es')
    expect(build({ path: '/' }).alternates.canonical).toBe('https://a.dd2.example/')
  })

  it('mirrors title, description and URL into Open Graph, with the site and locale', () => {
    const meta = build({}, 'es')

    expect(meta.openGraph).toEqual({
      type: 'website',
      title: 'About Our School — School A',
      description: 'We are a K–5 school of 480 students in Summerville.',
      url: 'https://a.dd2.example/es/about',
      siteName: 'School A',
      locale: 'es',
    })
  })

  it('omits the Open Graph description rather than sending an empty one', () => {
    expect('description' in build({ body: [] }).openGraph).toBe(false)
  })

  it('is noindex,nofollow unless indexing is allowed', () => {
    expect(build({}, 'en', false).robots).toEqual({ index: false, follow: false })
    expect(build().robots).toEqual({ index: true, follow: true })
  })
})

describe('indexingAllowed', () => {
  it('FAILS CLOSED — only an explicit "allow" opens a site to search engines', () => {
    /**
     * Staging mirrors production with pilot data (`09` §1). An unset variable is the state
     * every new environment starts in, so unset has to mean "keep out".
     */
    expect(indexingAllowed({})).toBe(false)
    expect(indexingAllowed({ SITE_INDEXING: '' })).toBe(false)
    expect(indexingAllowed({ SITE_INDEXING: 'true' })).toBe(false)
    expect(indexingAllowed({ SITE_INDEXING: 'ALLOW' })).toBe(false)
    expect(indexingAllowed({ SITE_INDEXING: 'allow' })).toBe(true)
  })
})

describe('buildRobotsTxt', () => {
  it('keeps everything out when indexing is not allowed — and offers no sitemap', () => {
    expect(buildRobotsTxt({ origin: 'https://a.dd2.example', indexable: false })).toBe(
      'User-agent: *\nDisallow: /\n',
    )
  })

  it('allows the site, keeps crawlers out of the admin and API, and names the sitemap', () => {
    expect(buildRobotsTxt({ origin: 'https://a.dd2.example', indexable: true })).toBe(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /api',
        '',
        'Sitemap: https://a.dd2.example/sitemap.xml',
        '',
      ].join('\n'),
    )
  })
})

describe('buildSitemapXml', () => {
  const xml = buildSitemapXml({
    origin: 'https://a.dd2.example',
    paths: ['/', '/about'],
    locales: ['en', 'es'],
  })

  it('lists every page in every locale (`08` §5)', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
    expect(locs).toEqual([
      'https://a.dd2.example/',
      'https://a.dd2.example/es',
      'https://a.dd2.example/about',
      'https://a.dd2.example/es/about',
    ])
  })

  it('gives each entry the full alternate set, itself included, plus x-default', () => {
    // Google ignores hreflang annotations that are not reciprocal and self-referencing.
    const first = xml.slice(xml.indexOf('<url>'), xml.indexOf('</url>'))
    const alternates = [...first.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [
      m[1],
      m[2],
    ])
    expect(alternates).toEqual([
      ['en', 'https://a.dd2.example/'],
      ['es', 'https://a.dd2.example/es'],
      ['x-default', 'https://a.dd2.example/'],
    ])
  })

  it('declares both namespaces and is well-formed at the edges', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset ')).toBe(true)
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true)
  })

  it('escapes what XML requires — a path is data', () => {
    const escaped = buildSitemapXml({
      origin: 'https://a.dd2.example',
      paths: ['/a&b<c>"d\''],
      locales: ['en'],
    })
    expect(escaped).toContain('<loc>https://a.dd2.example/a&amp;b&lt;c&gt;&quot;d&apos;</loc>')
  })

  it('is a valid, empty urlset for a tenant with no pages', () => {
    const empty = buildSitemapXml({ origin: 'https://a.dd2.example', paths: [], locales: ['en'] })
    expect(empty).not.toContain('<url>')
    expect(empty).toContain('</urlset>')
  })
})
