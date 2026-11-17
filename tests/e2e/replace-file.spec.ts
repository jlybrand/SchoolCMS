import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { tinyPdf } from '../helpers/files'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { followLink } from './support/follow-link'
import { schoolTest, tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * "Replace a file" on the school plane (Jason, 2026-11-16): a new version of a file in the old
 * one's place — the same kind only — and every page using it shows the new one, with no page
 * edit. An image's description is asked again, prefilled; a document is marked not checked. No
 * approval. Built, then locked here (CLAUDE.md: admin views are not test-first); the rules are
 * `tests/unit/admin/replace-file.test.ts` and `tests/integration/resources.test.ts`.
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

/** Two different real PNGs — 2×2 and 3×1 — so the replacement is a different file. */
const PNG_OLD = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNkYGD4z8DAwMDAwMAAAAgPAQBJpJ4YAAAAAElFTkSuQmCC',
  'base64',
)
const PNG_NEW = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAIAAACUgoPjAAAADUlEQVR4nGM4YaMBQQATfgOF3lIiyQAAAABJRU5ErkJggg==',
  'base64',
)

type Fixture = { admin: APIRequestContext; image: number; doc: number; page: number; slug: string }

const upload = async (
  admin: APIRequestContext,
  tenant: number,
  file: { name: string; mimeType: string; buffer: Buffer },
  data: Record<string, unknown>,
) => {
  const res = await admin.post('/api/resources?depth=0', {
    multipart: { file, _payload: JSON.stringify({ tenant, ...data }) },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()).doc as { id: number }).id
}

const setUp = async (baseURL: string | undefined): Promise<Fixture> => {
  const admin = await playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })
  const tenant = await tenantIdFor(admin, 'a.localhost')
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const image = await upload(
    admin,
    tenant,
    { name: `fair-${stamp}.png`, mimeType: 'image/png', buffer: PNG_OLD },
    { title: uniqueTitle('Science fair photo'), alt: 'Students at last year’s fair' },
  )
  const pdf = tinyPdf()
  const doc = await upload(
    admin,
    tenant,
    { name: `menu-${stamp}.pdf`, mimeType: pdf.mimetype, buffer: pdf.data },
    { title: uniqueTitle('Lunch menu'), remediationStatus: 'attested' },
  )
  const slug = `replace-${stamp}`
  const made = await admin.post('/api/pages?depth=0', {
    data: {
      tenant,
      title: uniqueTitle('Our fair'),
      slug,
      visibility: 'public',
      layout: [{ blockType: 'image', image, caption: 'The fair' }],
      _status: 'published',
    },
  })
  expect(made.ok(), await made.text()).toBe(true)
  return { admin, image, doc, page: ((await made.json()).doc as { id: number }).id, slug }
}

const tearDown = async ({ admin, image, doc, page }: Fixture) => {
  await admin.delete(`/api/pages/${page}`)
  for (const id of [image, doc]) await admin.delete(`/api/resources/${id}`)
  await admin.dispose()
}

const stored = async (admin: APIRequestContext, id: number) =>
  (await (await admin.get(`/api/resources/${id}?depth=0`)).json()) as {
    title: string
    filename: string
    url: string
    alt: string
    remediationStatus: string
  }

schoolTest.describe('a school replaces a file', () => {
  schoolTest.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    schoolTest(
      `@a11y an image: chosen from the list, its description asked again, and the page shows the new one — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const fixture = await setUp(baseURL)
        try {
          const before = await stored(fixture.admin, fixture.image)

          // From the start screen.
          await page.goto('/admin')
          await followLink(
            page,
            page.getByRole('link', { name: /Replace a file/ }),
            /\/admin\/replace-file$/,
          )
          await expect(
            page.getByRole('heading', { name: 'Which file do you want to replace?' }),
          ).toBeVisible()
          expect(await blockingViolations(page)).toEqual([])

          // Same path, a new query: click, and wait for the form itself.
          await page.getByRole('link', { name: before.title }).click()
          await expect(
            page.getByRole('heading', { name: `Replace “${before.title}”` }),
          ).toBeVisible()
          // The description is asked again, prefilled with the one it has.
          const description = page.getByLabel('Describe the new image')
          await expect(description).toHaveValue('Students at last year’s fair')
          expect(await blockingViolations(page)).toEqual([])

          await page.getByLabel('The new file').setInputFiles({
            name: `fair-new-${Date.now()}.png`,
            mimeType: 'image/png',
            buffer: PNG_NEW,
          })
          await description.fill('Students at this year’s fair')
          await page.getByRole('button', { name: 'Replace' }).click()
          await expect(page.locator('#replace-file').getByRole('status')).toContainText(
            `Replaced “${before.title}”`,
            { timeout: 20_000 },
          )
          expect(await blockingViolations(page)).toEqual([])

          // The same entry, a new file and description.
          const after = await stored(fixture.admin, fixture.image)
          expect(after.filename).not.toBe(before.filename)
          expect(after.alt).toBe('Students at this year’s fair')

          // The page using it shows the new one — no page edit, refreshed within seconds.
          await expect(async () => {
            await page.goto(siteUrl(baseURL, 'a.localhost', `/${fixture.slug}`))
            const img = page.getByRole('img', { name: 'Students at this year’s fair' })
            await expect(img).toBeVisible({ timeout: 1_000 })
            await expect(img).toHaveAttribute(
              'src',
              new RegExp(after.filename.replace(/\.png$/, '')),
            )
          }).toPass({ timeout: 20_000 })
        } finally {
          await tearDown(fixture)
        }
      },
    )
  }

  schoolTest(
    'a document is marked not checked; a file of the other kind is refused at the file',
    async ({ page, baseURL }) => {
      const fixture = await setUp(baseURL)
      try {
        const before = await stored(fixture.admin, fixture.doc)
        await page.goto(`/admin/replace-file?file=${fixture.doc}`)
        await expect(page.getByText(/marked not checked for accessibility/)).toBeVisible({
          timeout: 20_000,
        })

        // An image for a document: refused, beside the file.
        await page.getByLabel('The new file').setInputFiles({
          name: 'wrong.png',
          mimeType: 'image/png',
          buffer: PNG_NEW,
        })
        await page.getByRole('button', { name: 'Replace' }).click()
        await expect(
          page.getByText('Replace an image with an image, or a document with a document.'),
        ).toBeVisible()
        await expect(page.getByLabel('The new file')).toBeFocused()

        const pdf = tinyPdf()
        await page.getByLabel('The new file').setInputFiles({
          name: `menu-new-${Date.now()}.pdf`,
          mimeType: pdf.mimetype,
          buffer: pdf.data,
        })
        await page.getByRole('button', { name: 'Replace' }).click()
        await expect(page.locator('#replace-file').getByRole('status')).toContainText('Replaced', {
          timeout: 20_000,
        })
        const after = await stored(fixture.admin, fixture.doc)
        expect(after.filename).not.toBe(before.filename)
        expect(after.remediationStatus).toBe('not-attested')
      } finally {
        await tearDown(fixture)
      }
    },
  )

  schoolTest('the file’s own page links to its replace form', async ({ page, baseURL }) => {
    const fixture = await setUp(baseURL)
    try {
      await page.goto(`/admin/collections/resources/${fixture.image}`)
      await expect(page.getByRole('link', { name: 'Replace this file' })).toHaveAttribute(
        'href',
        `/admin/replace-file?file=${fixture.image}`,
        { timeout: 20_000 },
      )
    } finally {
      await tearDown(fixture)
    }
  })
})
