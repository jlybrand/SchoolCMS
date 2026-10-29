import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * Permalinks (Jason, 2026-10-29): `/p/<id>` redirects to wherever the page is now, and keeps
 * doing so after the page is renamed and moved. Another site's id, a draft, and junk all 404.
 *
 * The lookup and its isolation are proven in `tests/integration/content-layer.test.ts`; this
 * drives the real route, through the proxy, on real hostnames.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

const asDistrict = (baseURL: string | undefined) =>
  playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })

const mkPage = async (
  admin: APIRequestContext,
  hostname: string,
  data: Record<string, unknown> = {},
) => {
  const slug = `permalink-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const res = await admin.post('/api/pages?depth=0', {
    data: {
      tenant: await tenantIdFor(admin, hostname),
      title: uniqueTitle('Permalink'),
      slug,
      pageType: 'standard',
      visibility: 'public',
      _status: 'published',
      ...data,
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return { id: ((await res.json()).doc as { id: number }).id, slug }
}

/** The redirect itself, not where a browser ends up: the status and Location are the contract. */
const locationOf = async (baseURL: string | undefined, hostname: string, path: string) => {
  const visitor = await playwrightRequest.newContext()
  try {
    const res = await visitor.get(siteUrl(baseURL, hostname, path), { maxRedirects: 0 })
    return { status: res.status(), location: res.headers()['location'] ?? null }
  } finally {
    await visitor.dispose()
  }
}

test.describe('page permalinks', () => {
  test.skip(credentials === null, SKIP)

  test('redirects to the page, and still does after it is renamed and moved', async ({
    baseURL,
  }) => {
    const admin = await asDistrict(baseURL)
    const made: number[] = []
    try {
      const page = await mkPage(admin, 'a.localhost')
      made.push(page.id)

      expect(await locationOf(baseURL, 'a.localhost', `/p/${page.id}`)).toEqual({
        status: 302,
        location: `/${page.slug}`,
      })

      const parent = await mkPage(admin, 'a.localhost')
      made.push(parent.id)
      const moved = await admin.patch(`/api/pages/${page.id}?depth=0`, {
        data: { parent: parent.id, slug: `${page.slug}-renamed`, _status: 'published' },
      })
      expect(moved.ok(), await moved.text()).toBe(true)

      // The publish purged the site, so the permalink answers with the new address at once.
      expect(await locationOf(baseURL, 'a.localhost', `/p/${page.id}`)).toEqual({
        status: 302,
        location: `/${parent.slug}/${page.slug}-renamed`,
      })
    } finally {
      for (const id of made.reverse()) await admin.delete(`/api/pages/${id}`)
      await admin.dispose()
    }
  })

  test("404s for another site's page, a draft, and anything that is not a page id", async ({
    baseURL,
  }) => {
    const admin = await asDistrict(baseURL)
    const made: number[] = []
    try {
      const onB = await mkPage(admin, 'b.localhost')
      const draft = await mkPage(admin, 'a.localhost', { _status: 'draft' })
      made.push(onB.id, draft.id)

      for (const path of [`/p/${onB.id}`, `/p/${draft.id}`, '/p/abc', '/p/0', '/p/012']) {
        expect((await locationOf(baseURL, 'a.localhost', path)).status, path).toBe(404)
      }
    } finally {
      for (const id of made) await admin.delete(`/api/pages/${id}`)
      await admin.dispose()
    }
  })

  /** Both of Payload's themes — the field takes its colours from Payload's inverting scale. */
  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`in the ${colorScheme} theme`, () => {
      test.use({ colorScheme, storageState: ADMIN_STORAGE_STATE })

      test('@a11y the page form shows the permanent link, with no blocking axe violations', async ({
        page,
        baseURL,
      }) => {
        const admin = await asDistrict(baseURL)
        const made = await mkPage(admin, 'a.localhost')
        try {
          await page.goto(`/admin/collections/pages/${made.id}`)
          await expect(page.getByText(`/p/${made.id}`)).toBeVisible({ timeout: 20_000 })

          const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze()
          const blocking = results.violations.filter(
            (v) => v.impact === 'critical' || v.impact === 'serious',
          )
          expect(blocking.map((v) => v.id)).toEqual([])
        } finally {
          await admin.delete(`/api/pages/${made.id}`)
          await admin.dispose()
        }
      })
    })
  }
})
