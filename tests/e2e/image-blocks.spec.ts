import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * The Image and Hero blocks on a public page (Jason, 2026-11-13): each image is a library file,
 * with the library's alt text; a hero's words sit on a band under its image, and a hero may have
 * no words at all. The rules are `tests/integration/image-blocks.test.ts`; the components' own
 * axe, LTR and RTL, is the Storybook gate.
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

/** A real 2×2 PNG — Payload checks what it is given. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNkYGD4z8DAwMDAwMAAAAgPAQBJpJ4YAAAAAElFTkSuQmCC',
  'base64',
)

type Fixture = { admin: APIRequestContext; page: number; files: number[]; slug: string }

const upload = async (admin: APIRequestContext, tenant: number, data: Record<string, unknown>) => {
  const res = await admin.post('/api/resources?depth=0', {
    multipart: {
      file: { name: `pic-${Date.now()}-${Math.random()}.png`, mimeType: 'image/png', buffer: PNG },
      _payload: JSON.stringify({ tenant, title: 'A picture', ...data }),
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()).doc as { id: number }).id
}

const setUp = async (baseURL: string | undefined): Promise<Fixture> => {
  const admin = await playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })
  const tenant = await tenantIdFor(admin, 'b.localhost')
  const front = await upload(admin, tenant, { alt: 'The front of the school' })
  const fair = await upload(admin, tenant, { alt: 'Students showing their volcano' })
  const slug = `pictures-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const made = await admin.post('/api/pages?depth=0', {
    data: {
      tenant,
      title: uniqueTitle('Pictures'),
      slug,
      visibility: 'public',
      layout: [
        {
          blockType: 'hero',
          image: front,
          heading: 'Welcome to School B',
          subheading: 'Home of the Hawks.',
          linkType: 'address',
          href: '/enroll',
          linkLabel: 'Start enrollment',
        },
        { blockType: 'image', image: fair, caption: 'The science fair, in the gym.' },
        { blockType: 'hero', image: front, linkType: 'none' },
      ],
      _status: 'published',
    },
  })
  expect(made.ok(), await made.text()).toBe(true)
  return { admin, page: ((await made.json()).doc as { id: number }).id, files: [front, fair], slug }
}

const tearDown = async ({ admin, page, files }: Fixture) => {
  await admin.delete(`/api/pages/${page}`)
  for (const id of files) await admin.delete(`/api/resources/${id}`)
  await admin.dispose()
}

test.describe('images on a page', () => {
  test.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@a11y a hero with words, an image with a caption, a hero with none — ${colorScheme}`, async ({
      page,
      baseURL,
    }) => {
      await page.emulateMedia({ colorScheme })
      const fixture = await setUp(baseURL)
      try {
        await expect(async () => {
          await page.goto(siteUrl(baseURL, 'b.localhost', `/${fixture.slug}`))
          await expect(page.getByRole('heading', { name: 'Welcome to School B' })).toBeVisible({
            timeout: 1_000,
          })
        }).toPass({ timeout: 15_000 })

        // The hero's words: its heading takes the block's level, under the page's own title.
        await expect(
          page.getByRole('heading', { name: 'Welcome to School B', level: 2 }),
        ).toBeVisible()
        await expect(page.getByText('Home of the Hawks.')).toBeVisible()
        await expect(page.getByRole('link', { name: 'Start enrollment' })).toHaveAttribute(
          'href',
          '/enroll',
        )
        // Every image with the library's alt text; the image-only hero is just its image.
        await expect(page.getByRole('img', { name: 'The front of the school' })).toHaveCount(2)
        const fair = page.getByRole('figure').filter({ hasText: 'The science fair, in the gym.' })
        await expect(
          fair.getByRole('img', { name: 'Students showing their volcano' }),
        ).toBeVisible()
        expect(await blockingViolations(page)).toEqual([])
      } finally {
        await tearDown(fixture)
      }
    })
  }
})
