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
 * A news feed on a page (Jason, 2026-10-28): the district puts "District news" on School B's
 * page; it shows the district announcements shared with School B, links each home, refreshes
 * when one is published, and is hidden when there is nothing to show.
 *
 * The query and the resolve pass are proven in `tests/integration/content-layer.test.ts`; this
 * drives a real page.
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
      { type: 'paragraph', version: 1, children: [{ type: 'text', text: 'Words.', version: 1 }] },
    ],
  },
}

const asDistrict = (baseURL: string | undefined) =>
  playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })

const boardOf = async (admin: APIRequestContext, hostname: string) => {
  const tenant = await tenantIdFor(admin, hostname)
  const res = await admin.get(`/api/post-boards?where[tenant][equals]=${tenant}&limit=1&depth=0`)
  return { tenant, board: ((await res.json()).docs as { id: number }[])[0]!.id }
}

/** A published composed page on `hostname` carrying one feed. */
const pageWithFeed = async (
  admin: APIRequestContext,
  hostname: string,
  feed: { heading: string; boards: number[] },
) => {
  const tenant = await tenantIdFor(admin, hostname)
  const slug = `feed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const res = await admin.post('/api/pages?depth=0', {
    data: {
      tenant,
      title: uniqueTitle('Our news'),
      slug,
      visibility: 'public',
      // Ten, the most: specs running alongside publish district announcements too.
      layout: [{ blockType: 'feed', heading: feed.heading, boards: feed.boards, limit: 10 }],
      _status: 'published',
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return { id: ((await res.json()).doc as { id: number }).id, slug }
}

const sharedPost = async (admin: APIRequestContext, title: string) => {
  const { tenant, board } = await boardOf(admin, 'localhost')
  const res = await admin.post('/api/posts?depth=0', {
    data: {
      tenant,
      board,
      title,
      body: BODY,
      visibility: 'public',
      syndication: { scope: 'district-wide' },
      _status: 'published',
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json()).doc as { id: number; slug: string }
}

test.describe('a news feed on a page', () => {
  test.skip(credentials === null, SKIP)

  test('@smoke shows shared district news, links home, and refreshes when one is published', async ({
    page,
    baseURL,
  }) => {
    const admin = await asDistrict(baseURL)
    const { board } = await boardOf(admin, 'localhost')
    const firstTitle = uniqueTitle('Early dismissal')
    const first = await sharedPost(admin, firstTitle)
    const made = await pageWithFeed(admin, 'b.localhost', {
      heading: 'District news',
      boards: [board],
    })
    let second: { id: number; slug: string } | null = null
    try {
      const url = siteUrl(baseURL, 'b.localhost', `/${made.slug}`)
      const feed = page.getByRole('region', { name: 'District news' })
      await expect(async () => {
        await page.goto(url)
        await expect(feed).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })

      // Headlines sit under the feed's own heading; a shared one links to its home site.
      await expect(feed.getByRole('heading', { level: 3 }).first()).toBeVisible()
      await expect(feed.getByRole('link', { name: firstTitle })).toHaveAttribute(
        'href',
        /^https?:\/\/localhost(:\d+)?\/news\//,
      )
      await expect(feed.getByRole('link', { name: 'More news' })).toHaveAttribute('href', '/news')

      // A new district announcement reaches this page within seconds of being published.
      const title = uniqueTitle('Snow day')
      second = await sharedPost(admin, title)
      await expect(async () => {
        await page.goto(url)
        await expect(feed.getByRole('link', { name: title })).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
    } finally {
      await admin.delete(`/api/pages/${made.id}`)
      await admin.delete(`/api/posts/${first.id}`)
      if (second) await admin.delete(`/api/posts/${second.id}`)
      await admin.dispose()
    }
  })

  test('a feed with nothing to show is not on the page at all', async ({ page, baseURL }) => {
    const admin = await asDistrict(baseURL)
    // School A's board seen from School B: none of A's announcements are shared with B.
    const { board } = await boardOf(admin, 'a.localhost')
    const made = await pageWithFeed(admin, 'b.localhost', {
      heading: 'School A news',
      boards: [board],
    })
    try {
      await page.goto(siteUrl(baseURL, 'b.localhost', `/${made.slug}`))
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText('School A news')).toHaveCount(0)
    } finally {
      await admin.delete(`/api/pages/${made.id}`)
      await admin.dispose()
    }
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@a11y a page with a feed has zero critical or serious axe violations — ${colorScheme}`, async ({
      page,
      baseURL,
    }) => {
      const admin = await asDistrict(baseURL)
      const { board } = await boardOf(admin, 'localhost')
      const post = await sharedPost(admin, uniqueTitle('Book fair'))
      const made = await pageWithFeed(admin, 'b.localhost', {
        heading: 'District news',
        boards: [board],
      })
      try {
        await page.emulateMedia({ colorScheme })
        await expect(async () => {
          await page.goto(siteUrl(baseURL, 'b.localhost', `/${made.slug}`))
          await expect(page.getByRole('region', { name: 'District news' })).toBeVisible({
            timeout: 1_000,
          })
        }).toPass({ timeout: 15_000 })
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
        expect(
          results.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? '')),
        ).toEqual([])
      } finally {
        await admin.delete(`/api/pages/${made.id}`)
        await admin.delete(`/api/posts/${post.id}`)
        await admin.dispose()
      }
    })
  }
})
