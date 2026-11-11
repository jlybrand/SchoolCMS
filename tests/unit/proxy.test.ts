import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { config, proxy } from '@/proxy'

/**
 * Edge routing for the two per-tenant files (`01` §3 item 13).
 *
 * `/robots.txt` and `/sitemap.xml` are one URL on 28 hosts with 28 different answers — a
 * school's sitemap lists that school's pages. The proxy's general matcher skips anything
 * with a file extension, so without an explicit route these two would bypass tenant
 * resolution entirely and every site would serve the same file.
 */

const rewriteOf = (url: string, host: string): string | null => {
  const response = proxy(new NextRequest(url, { headers: { host } }))
  const target = response.headers.get('x-middleware-rewrite')
  return target === null ? null : new URL(target).pathname
}

describe('proxy — per-tenant files', () => {
  it.each([
    ['/robots.txt', 'a.localhost', '/sites/a.localhost/robots'],
    ['/sitemap.xml', 'a.localhost', '/sites/a.localhost/sitemap'],
    ['/sitemap.xml', 'B.LOCALHOST:3000', '/sites/b.localhost/sitemap'],
  ])('rewrites %s on %s to the tenant route', (path, host, expected) => {
    expect(rewriteOf(`http://${host}${path}`, host)).toBe(expected)
  })

  it('does NOT put them under a locale — there is one of each per site, not one per language', () => {
    expect(rewriteOf('http://a.localhost/robots.txt', 'a.localhost')).not.toContain('/en/')
  })

  it('a locale-prefixed spelling is an ordinary page path, and 404s as one', () => {
    // `/es/sitemap.xml` is not a thing; it must not resolve to the real sitemap.
    expect(rewriteOf('http://a.localhost/es/sitemap.xml', 'a.localhost')).toBe(
      '/sites/a.localhost/es/sitemap.xml',
    )
  })

  it('still refuses a direct request for the rewrite target', () => {
    const response = proxy(
      new NextRequest('http://a.localhost/sites/b.localhost/sitemap', {
        headers: { host: 'a.localhost' },
      }),
    )
    // Otherwise any host could read any tenant's sitemap by asking for it by name.
    expect(response.status).toBe(404)
  })

  it('the matcher covers ALL of /sites/ — or the refusal above never runs for a path with an extension', () => {
    /**
     * The general pattern skips any path ending in a listed extension as a static asset. A
     * guard the matcher never invokes is not a guard, so `/sites` is matched as a whole.
     */
    expect(config.matcher).toContain('/sites/:path*')
  })

  it('the matcher names both files — the general pattern excludes .txt and .xml', () => {
    expect(config.matcher).toContain('/robots.txt')
    expect(config.matcher).toContain('/sitemap.xml')
  })
})

describe('proxy — a calendar’s iCal feed (Jason, 2026-11-11)', () => {
  it.each([
    ['/calendars/12.ics', 'a.localhost', '/sites/a.localhost/calendar-feed/12'],
    ['/calendars/7.ics', 'B.LOCALHOST:3000', '/sites/b.localhost/calendar-feed/7'],
  ])('rewrites %s on %s to the tenant’s feed route', (path, host, expected) => {
    expect(rewriteOf(`http://${host}${path}`, host)).toBe(expected)
  })

  it.each([
    ['not a calendar id', '/calendars/abc.ics', '/sites/a.localhost/en/calendars/abc.ics'],
    ['under a locale', '/es/calendars/12.ics', '/sites/a.localhost/es/calendars/12.ics'],
    ['nested', '/calendars/12/13.ics', '/sites/a.localhost/en/calendars/12/13.ics'],
  ])('%s is an ordinary page path, and 404s as one', (_label, path, expected) => {
    expect(rewriteOf(`http://a.localhost${path}`, 'a.localhost')).toBe(expected)
  })

  it('the matcher reaches .ics — the general pattern does not skip it as an asset', () => {
    const general = new RegExp(`^${config.matcher[0]!.replace('/(', '/(')}$`)
    expect(general.test('/calendars/12.ics')).toBe(true)
  })
})

describe('proxy — pages, unchanged', () => {
  it.each([
    ['/', '/sites/a.localhost/en'],
    ['/about/staff', '/sites/a.localhost/en/about/staff'],
    ['/es/about', '/sites/a.localhost/es/about'],
  ])('rewrites %s', (path, expected) => {
    expect(rewriteOf(`http://a.localhost${path}`, 'a.localhost')).toBe(expected)
  })
})

/**
 * Live Preview (Jason, 2026-11-10) frames `/admin-preview/pages/<id>` from the admin. It must stay
 * on the ADMIN host, unrewritten: rewritten into a tenant site it would be another origin, the
 * admin's session cookie would not reach it, and it would show nothing.
 */
describe('proxy — the admin’s page preview is left alone', () => {
  const general = new RegExp(`^${config.matcher[0]}$`)

  it('the general pattern does not match /admin-preview', () => {
    expect(general.test('/admin-preview/pages/5')).toBe(false)
  })

  it('…while it still matches a page whose address merely contains the word', () => {
    expect(general.test('/about/admin-preview')).toBe(true)
  })
})
