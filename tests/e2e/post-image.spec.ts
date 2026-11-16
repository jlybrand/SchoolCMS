import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * An announcement's image (Jason, 2026-11-13; Phase 6 B2), on the public site: under the headline
 * of its page with the library's alt text, and as a thumbnail in the news list with EMPTY alt text
 * — the headline beside it says it. The rules are `tests/integration/post-image.test.ts`.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'
const BLOCKING = ['critical', 'serious']
const HOST = 'b.localhost'

const blockingViolations = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations
    .filter((v) => BLOCKING.includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)

/** A real 2×2 PNG — Payload checks what it is given. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNkYGD4z8DAwMDAwMAAAAgPAQBJpJ4YAAAAAElFTkSuQmCC',
  'base64',
)

const BODY = {
  root: {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [{ type: 'text', text: 'Photos in the gym during homeroom.', version: 1 }],
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  },
}

type Fixture = { admin: APIRequestContext; post: number; file: number; slug: string; title: string }

const setUp = async (baseURL: string | undefined): Promise<Fixture> => {
  const admin = await playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })
  const tenant = await tenantIdFor(admin, HOST)
  const uploaded = await admin.post('/api/resources?depth=0', {
    multipart: {
      file: { name: `post-${Date.now()}-${Math.random()}.png`, mimeType: 'image/png', buffer: PNG },
      _payload: JSON.stringify({
        tenant,
        title: 'Picture day',
        alt: 'Students lined up for photos',
      }),
    },
  })
  expect(uploaded.ok(), await uploaded.text()).toBe(true)
  const file = ((await uploaded.json()).doc as { id: number }).id

  const boards = await admin.get(
    `/api/post-boards?where[tenant][equals]=${tenant}&where[name][equals]=News&limit=1&depth=0`,
  )
  const board = ((await boards.json()).docs as { id: number }[])[0]!.id
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const title = `Picture day ${stamp}`
  const slug = `picture-day-${stamp}`
  const made = await admin.post('/api/posts?depth=0', {
    data: {
      tenant,
      board,
      title,
      slug,
      body: BODY,
      visibility: 'public',
      heroImage: file,
      // Featured, so it heads the news list however many announcements the run has made.
      featuredUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      _status: 'published',
    },
  })
  expect(made.ok(), await made.text()).toBe(true)
  return { admin, post: ((await made.json()).doc as { id: number }).id, file, slug, title }
}

const tearDown = async ({ admin, post, file }: Fixture) => {
  await admin.delete(`/api/posts/${post}`)
  await admin.delete(`/api/resources/${file}`)
  await admin.dispose()
}

test.describe('an announcement’s image', () => {
  test.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@a11y under the headline on its page; a thumbnail in the news list — ${colorScheme}`, async ({
      page,
      baseURL,
    }) => {
      await page.emulateMedia({ colorScheme })
      const fixture = await setUp(baseURL)
      try {
        // Its page: the headline, then the image with the library's alt text.
        await expect(async () => {
          await page.goto(siteUrl(baseURL, HOST, `/news/${fixture.slug}`))
          await expect(page.getByRole('heading', { name: fixture.title, level: 1 })).toBeVisible({
            timeout: 1_000,
          })
        }).toPass({ timeout: 15_000 })
        const image = page.getByRole('img', { name: 'Students lined up for photos' })
        await expect(image).toBeVisible()
        await expect(image).toHaveAttribute('loading', 'eager')
        expect(await blockingViolations(page)).toEqual([])

        // The news list: a thumbnail beside the headline, with empty alt text.
        await expect(async () => {
          await page.goto(siteUrl(baseURL, HOST, '/news'))
          await expect(page.getByRole('link', { name: fixture.title })).toBeVisible({
            timeout: 1_000,
          })
        }).toPass({ timeout: 15_000 })
        const item = page.getByRole('listitem').filter({ hasText: fixture.title })
        await expect(item.locator('img')).toHaveAttribute('alt', '')
        await expect(page.getByRole('img', { name: 'Students lined up for photos' })).toHaveCount(0)
        expect(await blockingViolations(page)).toEqual([])
      } finally {
        await tearDown(fixture)
      }
    })
  }
})
