import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { SCHOOL_HOSTNAME, schoolTest, tenantIdFor } from './support/school-session'
import { openPageSettings } from './support/page-settings'
import { siteUrl } from './support/site-url'

/**
 * Linked pages, internal redirect (Jason, 2026-10-29): visiting the page sends the visitor to a
 * page on the same site or a district page; renaming the target moves every redirect with it;
 * the page is out of the sitemap; and both planes mark it with the linked icon, and only that.
 *
 * Published fixtures live on School B and the district site — the routing specs count School A's
 * sitemap exactly. The school-plane check uses a DRAFT on School A, the manager's own school.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'
const BLOCKING = ['critical', 'serious']

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
  const slug = `linked-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const res = await admin.post('/api/pages?depth=0', {
    data: {
      tenant: await tenantIdFor(admin, hostname),
      title: uniqueTitle('Redirect'),
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

const PORT = () => new URL(test.info().project.use.baseURL ?? 'http://localhost:3000').port

const locationOf = async (baseURL: string | undefined, hostname: string, path: string) => {
  const visitor = await playwrightRequest.newContext()
  try {
    const res = await visitor.get(siteUrl(baseURL, hostname, path), { maxRedirects: 0 })
    return { status: res.status(), location: res.headers()['location'] ?? null }
  } finally {
    await visitor.dispose()
  }
}

test.describe('linked pages — internal redirect', () => {
  test.skip(credentials === null, SKIP)

  test('sends visitors to a page on the same site, and to a district page', async ({ baseURL }) => {
    const admin = await asDistrict(baseURL)
    const made: number[] = []
    try {
      const local = await mkPage(admin, 'b.localhost')
      const district = await mkPage(admin, 'localhost')
      made.push(local.id, district.id)
      const toLocal = await mkPage(admin, 'b.localhost', {
        linkMode: 'redirect',
        linkTo: 'site',
        linkTarget: local.id,
      })
      const toDistrict = await mkPage(admin, 'b.localhost', {
        linkMode: 'redirect',
        linkTo: 'district',
        districtLinkTarget: district.id,
      })
      made.push(toLocal.id, toDistrict.id)

      expect(await locationOf(baseURL, 'b.localhost', `/${toLocal.slug}`)).toEqual({
        status: 307,
        location: `/${local.slug}`,
      })
      expect(await locationOf(baseURL, 'b.localhost', `/${toDistrict.slug}`)).toEqual({
        status: 307,
        location: `http://localhost:${PORT()}/${district.slug}`,
      })

      // A redirect is not a page a sitemap lists.
      const visitor = await playwrightRequest.newContext()
      const sitemap = await (
        await visitor.get(siteUrl(baseURL, 'b.localhost', '/sitemap.xml'))
      ).text()
      await visitor.dispose()
      expect(sitemap).not.toContain(toLocal.slug)
      expect(sitemap).not.toContain(toDistrict.slug)
    } finally {
      for (const id of made.reverse()) await admin.delete(`/api/pages/${id}`)
      await admin.dispose()
    }
  })

  test("follows the district page when it is renamed — the school's site is refreshed too", async ({
    baseURL,
  }) => {
    const admin = await asDistrict(baseURL)
    const made: number[] = []
    try {
      const district = await mkPage(admin, 'localhost')
      made.push(district.id)
      const linked = await mkPage(admin, 'b.localhost', {
        linkMode: 'redirect',
        linkTo: 'district',
        districtLinkTarget: district.id,
      })
      made.push(linked.id)
      // Warm School B's cached copy before the rename.
      expect((await locationOf(baseURL, 'b.localhost', `/${linked.slug}`)).location).toContain(
        `/${district.slug}`,
      )

      const renamed = await admin.patch(`/api/pages/${district.id}?depth=0`, {
        data: { slug: `${district.slug}-renamed`, _status: 'published' },
      })
      expect(renamed.ok(), await renamed.text()).toBe(true)

      expect((await locationOf(baseURL, 'b.localhost', `/${linked.slug}`)).location).toBe(
        `http://localhost:${PORT()}/${district.slug}-renamed`,
      )
    } finally {
      for (const id of made.reverse()) await admin.delete(`/api/pages/${id}`)
      await admin.dispose()
    }
  })

  test('404s when the page it sends visitors to is not live', async ({ baseURL }) => {
    const admin = await asDistrict(baseURL)
    const made: number[] = []
    try {
      const draft = await mkPage(admin, 'localhost', { _status: 'draft' })
      made.push(draft.id)
      const linked = await mkPage(admin, 'b.localhost', {
        linkMode: 'redirect',
        linkTo: 'district',
        districtLinkTarget: draft.id,
      })
      made.push(linked.id)
      expect((await locationOf(baseURL, 'b.localhost', `/${linked.slug}`)).status).toBe(404)
    } finally {
      for (const id of made.reverse()) await admin.delete(`/api/pages/${id}`)
      await admin.dispose()
    }
  })
})

/** The mark on both planes, with no blocking axe violations, in both themes. */
for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`the linked mark — ${colorScheme}`, () => {
    test.skip(credentials === null, SKIP)
    test.use({ colorScheme })

    test.describe('district', () => {
      test.use({ storageState: ADMIN_STORAGE_STATE })

      test(`@a11y the page list marks it with the icon, and Page settings shows the choice — ${colorScheme}`, async ({
        page,
        baseURL,
      }) => {
        const admin = await asDistrict(baseURL)
        const made: number[] = []
        try {
          const district = await mkPage(admin, 'localhost')
          made.push(district.id)
          const linked = await mkPage(admin, 'b.localhost', {
            title: uniqueTitle('Marked'),
            linkMode: 'redirect',
            linkTo: 'district',
            districtLinkTarget: district.id,
          })
          made.push(linked.id)

          // The mark alone identifies a linked page (Jason, 2026-10-29) — no word beside it.
          await page.goto(`/admin/collections/pages?where[id][equals]=${linked.id}`)
          await expect(
            page.locator('tbody tr').first().getByRole('img', { name: 'Linked page' }),
          ).toBeVisible({ timeout: 20_000 })
          await expect(page.locator('tbody tr').first()).not.toContainText('Linked', {
            useInnerText: true,
          })

          await page.goto(`/admin/collections/pages/${linked.id}`)
          // The choice is a Page setting, behind the toolbar's gear (Jason, 2026-10-29).
          await openPageSettings(page)
          await expect(
            page.getByRole('radio', { name: 'Send visitors to another page' }),
          ).toBeChecked({ timeout: 20_000 })
          // Repaired by A11yPatch before the audit: the chosen page's clear button.
          await expect(
            page.locator(
              '#field-districtLinkTarget .clear-indicator[aria-hidden="true"][tabindex="-1"]',
            ),
          ).toBeAttached({ timeout: 20_000 })
          await expect(page.locator('.ContentEditable__root[aria-label]').first()).toBeAttached({
            timeout: 20_000,
          })
          const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze()
          expect(
            results.violations.filter((v) => BLOCKING.includes(v.impact ?? '')).map((v) => v.id),
          ).toEqual([])
        } finally {
          for (const id of made.reverse()) await admin.delete(`/api/pages/${id}`)
          await admin.dispose()
        }
      })
    })

    schoolTest(
      `@a11y "Update a page" marks a linked page — ${colorScheme}`,
      async ({ page, baseURL }) => {
        const admin = await asDistrict(baseURL)
        const made: number[] = []
        try {
          const title = uniqueTitle('School redirect')
          const target = await mkPage(admin, SCHOOL_HOSTNAME, { _status: 'draft' })
          made.push(target.id)
          const linked = await mkPage(admin, SCHOOL_HOSTNAME, {
            title,
            linkMode: 'redirect',
            linkTo: 'site',
            linkTarget: target.id,
            _status: 'draft',
          })
          made.push(linked.id)

          await page.goto('/admin/update-page')
          const row = page.locator('#update-page li', { hasText: title })
          await expect(row.getByRole('img', { name: 'Linked page' })).toBeVisible({
            timeout: 20_000,
          })
          await expect(row).not.toContainText('Linked', { useInnerText: true })

          const results = await new AxeBuilder({ page })
            .include('#update-page')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze()
          expect(
            results.violations.filter((v) => BLOCKING.includes(v.impact ?? '')).map((v) => v.id),
          ).toEqual([])
        } finally {
          for (const id of made.reverse()) await admin.delete(`/api/pages/${id}`)
          await admin.dispose()
        }
      },
    )
  })
}
