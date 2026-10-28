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
 * The public announcement pages (Jason, 2026-10-28): `/news` lists a site's announcements and
 * those shared with it; `/news/{slug}` is one announcement, on its home site only.
 *
 * The rules are proven against Postgres in `tests/integration/content-layer.test.ts`; this
 * drives the real pages — the links, a 404 that does not leak, axe in both themes, and a
 * district announcement reaching a school's list within seconds of being published.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

const BODY = {
  root: {
    type: 'root',
    direction: null,
    format: '',
    indent: 0,
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [{ type: 'text', text: 'Photos are in the gym during homeroom.', version: 1 }],
      },
    ],
  },
}

type Made = { id: number; slug: string; title: string }

const asDistrict = (baseURL: string | undefined) =>
  playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })

/** An announcement made by the district on `hostname`'s site, as it asks. */
const makePost = async (
  admin: APIRequestContext,
  hostname: string,
  {
    title,
    status = 'published',
    syndication,
  }: {
    title: string
    status?: 'draft' | 'published'
    syndication?: { scope: 'district-wide' }
  },
): Promise<Made> => {
  const tenant = await tenantIdFor(admin, hostname)
  const boards = await admin.get(`/api/post-boards?where[tenant][equals]=${tenant}&limit=1`)
  const board = ((await boards.json()).docs as { id: number }[])[0]!.id
  const res = await admin.post(`/api/posts?depth=0${status === 'draft' ? '&draft=true' : ''}`, {
    data: {
      tenant,
      board,
      title,
      body: BODY,
      visibility: 'public',
      ...(syndication ? { syndication } : {}),
      _status: status,
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  const doc = (await res.json()).doc as { id: number; slug: string }
  return { id: doc.id, slug: doc.slug, title }
}

const axe = async (page: import('@playwright/test').Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    results.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? '')),
  ).toEqual([])
}

test.describe('announcement pages', () => {
  test.skip(credentials === null, SKIP)

  test('@smoke the list links to the announcement, which reads as an article', async ({
    page,
    baseURL,
  }) => {
    const admin = await asDistrict(baseURL)
    const post = await makePost(admin, 'a.localhost', { title: uniqueTitle('Picture day') })
    try {
      const link = page.getByRole('heading', { level: 2 }).getByRole('link', { name: post.title })
      // Publishing revalidates the list; a request in flight may still get the earlier copy.
      await expect(async () => {
        await page.goto(siteUrl(baseURL, 'a.localhost', '/news'))
        await expect(link).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      await expect(page.getByRole('heading', { level: 1, name: 'News' })).toBeVisible()
      await link.click()

      await expect(page).toHaveURL(new RegExp(`/news/${post.slug}$`))
      await expect(page.getByRole('heading', { level: 1, name: post.title })).toBeVisible()
      await expect(page.locator('main time')).toHaveAttribute('datetime', /^\d{4}-/)
      await expect(page.getByText('Photos are in the gym during homeroom.')).toBeVisible()
      await expect(page.getByRole('link', { name: 'All news' })).toHaveAttribute('href', '/news')
    } finally {
      await admin.delete(`/api/posts/${post.id}`)
      await admin.dispose()
    }
  })

  test('a draft, and a shared announcement on a site that is not its home, are not pages here', async ({
    request,
    baseURL,
  }) => {
    const admin = await asDistrict(baseURL)
    const draft = await makePost(admin, 'a.localhost', {
      title: uniqueTitle('Not yet'),
      status: 'draft',
    })
    const shared = await makePost(admin, 'localhost', {
      title: uniqueTitle('Early dismissal'),
      syndication: { scope: 'district-wide' },
    })
    try {
      expect(
        (await request.get(siteUrl(baseURL, 'a.localhost', `/news/${draft.slug}`))).status(),
      ).toBe(404)
      // Shared with School A, but its page is on the district site — one address per post.
      expect(
        (await request.get(siteUrl(baseURL, 'a.localhost', `/news/${shared.slug}`))).status(),
      ).toBe(404)
      expect(
        (await request.get(siteUrl(baseURL, 'localhost', `/news/${shared.slug}`))).status(),
      ).toBe(200)
    } finally {
      await admin.delete(`/api/posts/${draft.id}`)
      await admin.delete(`/api/posts/${shared.id}`)
      await admin.dispose()
    }
  })

  test('@smoke a district announcement reaches a school’s list within seconds, linking home', async ({
    page,
    baseURL,
  }) => {
    const admin = await asDistrict(baseURL)
    const listB = siteUrl(baseURL, 'b.localhost', '/news')
    // Render and cache School B's list first, so what follows is revalidation, not a first build.
    await page.goto(listB)
    const title = uniqueTitle('Snow day')
    const shared = await makePost(admin, 'localhost', {
      title,
      syndication: { scope: 'district-wide' },
    })
    try {
      await expect(async () => {
        await page.goto(listB)
        await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      await expect(page.getByRole('link', { name: title })).toHaveAttribute(
        'href',
        new RegExp(`^https?://localhost(:\\d+)?/news/${shared.slug}$`),
      )
    } finally {
      await admin.delete(`/api/posts/${shared.id}`)
      await admin.dispose()
    }
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@a11y the list and an announcement have zero critical or serious axe violations — ${colorScheme}`, async ({
      page,
      baseURL,
    }) => {
      const admin = await asDistrict(baseURL)
      const post = await makePost(admin, 'a.localhost', { title: uniqueTitle('Book fair') })
      try {
        await page.emulateMedia({ colorScheme })
        await expect(async () => {
          await page.goto(siteUrl(baseURL, 'a.localhost', '/news'))
          await expect(page.getByRole('link', { name: post.title })).toBeVisible({ timeout: 1_000 })
        }).toPass({ timeout: 15_000 })
        await axe(page)
        await page.goto(siteUrl(baseURL, 'a.localhost', `/news/${post.slug}`))
        await expect(page.getByRole('heading', { level: 1, name: post.title })).toBeVisible()
        await axe(page)
      } finally {
        await admin.delete(`/api/posts/${post.id}`)
        await admin.dispose()
      }
    })
  }
})
