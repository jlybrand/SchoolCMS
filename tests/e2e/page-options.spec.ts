import { expect, request as playwrightRequest, test } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * The district's page options (Jason, 2026-10-29), as a search engine meets them: a page hidden
 * from search engines is served, says `noindex` (but `follow`), and is missing from the
 * sitemap. Hidden-from-navigation is proven against the page tree in
 * `tests/integration/content-layer.test.ts`.
 *
 * On School B: the routing specs count School A's sitemap exactly (`tenant-routing.spec.ts`).
 * Robots meta is read from the HTTP response, never the live DOM: Next streams metadata, so
 * where it lands in the DOM depends on timing (see `tenant-routing.spec.ts`).
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

test.describe('page options', () => {
  test.skip(credentials === null, SKIP)

  test('a page hidden from search engines is served, noindex, and not in the sitemap', async ({
    baseURL,
  }) => {
    const admin = await playwrightRequest.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: ADMIN_STORAGE_STATE,
    })
    const visitor = await playwrightRequest.newContext()
    const slug = `hidden-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const made = await admin.post('/api/pages?depth=0', {
      data: {
        tenant: await tenantIdFor(admin, 'b.localhost'),
        title: uniqueTitle('Hidden from search'),
        slug,
        visibility: 'public',
        hideFromSearchEngines: true,
        _status: 'published',
      },
    })
    expect(made.ok(), await made.text()).toBe(true)
    const id = ((await made.json()).doc as { id: number }).id

    try {
      const page = await visitor.get(siteUrl(baseURL, 'b.localhost', `/${slug}`))
      expect(page.status()).toBe(200)
      const robots = /<meta name="robots" content="([^"]+)"/.exec(await page.text())?.[1]
      expect(robots).toBe('noindex, follow')

      const sitemap = await (
        await visitor.get(siteUrl(baseURL, 'b.localhost', '/sitemap.xml'))
      ).text()
      expect(sitemap).toContain('<loc>http://b.localhost/about</loc>')
      expect(sitemap).not.toContain(slug)
    } finally {
      await admin.delete(`/api/pages/${id}`)
      await admin.dispose()
      await visitor.dispose()
    }
  })
})
