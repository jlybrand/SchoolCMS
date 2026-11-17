import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, adminTest } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { schoolTest, tenantIdFor } from './support/school-session'

/**
 * "Where it's used" in a file's sidebar (Jason, 2026-11-17), on both planes: the published pages
 * and announcements showing the file, and the sites a shared announcement reaches. Built, then
 * locked here (CLAUDE.md: admin views are not test-first); the rule is
 * `tests/unit/lib/file-uses.test.ts` and `tests/integration/file-uses.test.ts`.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'
const BLOCKING = ['critical', 'serious']

const blockingViolations = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations
    .filter((v) => BLOCKING.includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNkYGD4z8DAwMDAwMAAAAgPAQBJpJ4YAAAAAElFTkSuQmCC',
  'base64',
)

const BODY = {
  root: {
    type: 'root',
    children: [
      { type: 'paragraph', version: 1, children: [{ type: 'text', text: 'Body.', version: 1 }] },
    ],
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  },
}

type Fixture = {
  admin: APIRequestContext
  image: number
  page: number
  pageTitle: string
  post: number
  postTitle: string
  otherSite: string
}

const ok = async (res: Awaited<ReturnType<APIRequestContext['post']>>) => {
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()).doc as { id: number }).id
}

const setUp = async (baseURL: string | undefined): Promise<Fixture> => {
  const admin = await playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })
  const tenant = await tenantIdFor(admin, 'a.localhost')
  const other = await tenantIdFor(admin, 'b.localhost')
  const otherSite = (
    (await (await admin.get(`/api/tenants/${other}?depth=0`)).json()) as {
      name: string
    }
  ).name
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  const image = await ok(
    await admin.post('/api/resources?depth=0', {
      multipart: {
        file: { name: `uses-${stamp}.png`, mimeType: 'image/png', buffer: PNG },
        _payload: JSON.stringify({ tenant, title: uniqueTitle('Uses photo'), alt: 'The gym' }),
      },
    }),
  )
  const pageTitle = uniqueTitle('Uses page')
  const page = await ok(
    await admin.post('/api/pages?depth=0', {
      data: {
        tenant,
        title: pageTitle,
        slug: `uses-${stamp}`,
        visibility: 'public',
        layout: [{ blockType: 'image', image }],
        _status: 'published',
      },
    }),
  )
  const boards = (await (
    await admin.get(
      `/api/post-boards?where[tenant][equals]=${tenant}&where[name][equals]=News&limit=1&depth=0`,
    )
  ).json()) as { docs: { id: number }[] }
  const postTitle = uniqueTitle('Uses news')
  const post = await ok(
    await admin.post('/api/posts?depth=0', {
      data: {
        tenant,
        board: boards.docs[0]!.id,
        title: postTitle,
        slug: `uses-news-${stamp}`,
        body: BODY,
        visibility: 'public',
        heroImage: image,
        syndication: { scope: 'selected', syndicatedTo: [other] },
        _status: 'published',
      },
    }),
  )
  return { admin, image, page, pageTitle, post, postTitle, otherSite }
}

const tearDown = async ({ admin, image, page, post }: Fixture) => {
  await admin.delete(`/api/posts/${post}`)
  await admin.delete(`/api/pages/${page}`)
  await admin.delete(`/api/resources/${image}`)
  await admin.dispose()
}

const checkPanel = async (page: Page, fixture: Fixture) => {
  await page.goto(`/admin/collections/resources/${fixture.image}`)
  const panel = page.locator('#used-on')
  await expect(panel.getByRole('heading', { name: 'Where it’s used' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(panel.getByRole('link', { name: fixture.pageTitle })).toHaveAttribute(
    'href',
    `/admin/collections/pages/${fixture.page}`,
  )
  await expect(panel.getByRole('link', { name: fixture.postTitle })).toHaveAttribute(
    'href',
    `/admin/collections/posts/${fixture.post}`,
  )
  await expect(panel).toContainText(`Also on ${fixture.otherSite}`)
}

schoolTest.describe('a school sees where its file is used', () => {
  schoolTest.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    schoolTest(`@a11y the file’s sidebar — ${colorScheme}`, async ({ page, baseURL }) => {
      await page.emulateMedia({ colorScheme })
      const fixture = await setUp(baseURL)
      try {
        await checkPanel(page, fixture)
        expect(await blockingViolations(page)).toEqual([])
      } finally {
        await tearDown(fixture)
      }
    })
  }

  schoolTest('the replace form says what the replace affects', async ({ page, baseURL }) => {
    const fixture = await setUp(baseURL)
    try {
      await page.goto(`/admin/replace-file?file=${fixture.image}`)
      await expect(page.locator('#replace-used-on')).toHaveText(
        'Used on 1 page and 1 announcement.',
        { timeout: 20_000 },
      )
    } finally {
      await tearDown(fixture)
    }
  })
})

adminTest.describe('the district sees where a file is used', () => {
  adminTest.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(`@a11y the file’s sidebar — ${colorScheme}`, async ({ page, baseURL }) => {
      await page.emulateMedia({ colorScheme })
      const fixture = await setUp(baseURL)
      try {
        await checkPanel(page, fixture)
        expect(await blockingViolations(page)).toEqual([])
      } finally {
        await tearDown(fixture)
      }
    })
  }
})
