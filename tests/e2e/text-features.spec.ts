import AxeBuilder from '@axe-core/playwright'
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, adminTest } from './support/admin-session'
import { dropPage, makePage, openPage, uniqueTitle } from './support/fixture-pages'
import { SCHOOL_HOSTNAME, tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * The Text editor's added features (Jason, 2026-11-19, "a more robust text editor"): aligned
 * text, a quotation, a line, and an image from the site's library — on the public page, with no
 * blocking axe violation; and the toolbar's buttons, named in words, inserting into the page.
 *
 * Built, then locked here (CLAUDE.md: the editor's toolbar is admin React). The mapping and the
 * fill are unit- and integration-tested (`rich-text.test.ts`, `rich-text-images.test.ts`).
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

/** A real 2×2 PNG — Payload checks what it is given. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNkYGD4z8DAwMDAwMAAAAgPAQBJpJ4YAAAAAElFTkSuQmCC',
  'base64',
)

const blocking = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations
    .filter((v) => ['critical', 'serious'].includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)

const words = (text: string, format = '') => ({
  type: 'paragraph',
  version: 1,
  format,
  children: [{ type: 'text', version: 1, text }],
})

test.describe('the added text features on the public page', () => {
  test.skip(credentials === null, SKIP)

  test('@a11y centered text, a quotation, a line and a library image', async ({
    page,
    baseURL,
  }) => {
    const admin = await playwrightRequest.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: ADMIN_STORAGE_STATE,
    })
    const tenant = await tenantIdFor(admin, SCHOOL_HOSTNAME)
    const uploaded = await admin.post('/api/resources?depth=0', {
      multipart: {
        file: { name: `text-${Date.now()}.png`, mimeType: 'image/png', buffer: PNG },
        _payload: JSON.stringify({ tenant, title: 'Playground', alt: 'The new playground' }),
      },
    })
    expect(uploaded.ok(), await uploaded.text()).toBe(true)
    const file = ((await uploaded.json()) as { doc: { id: number } }).doc.id
    const slug = `text-features-${Date.now()}`
    const made = await admin.post('/api/pages?depth=0', {
      data: {
        tenant,
        title: uniqueTitle('Welcome back'),
        slug,
        visibility: 'public',
        _status: 'published',
        layout: [
          {
            blockType: 'richText',
            content: {
              root: {
                type: 'root',
                version: 1,
                children: [
                  words('The first day is Monday.', 'center'),
                  {
                    type: 'quote',
                    version: 1,
                    children: [{ type: 'text', version: 1, text: 'Every student, every day.' }],
                  },
                  { type: 'horizontalrule', version: 1 },
                  { type: 'upload', version: 3, relationTo: 'resources', value: file, fields: {} },
                  words('— The principal', 'right'),
                ],
              },
            },
          },
        ],
      },
    })
    expect(made.ok(), await made.text()).toBe(true)
    const id = ((await made.json()) as { doc: { id: number } }).doc.id
    try {
      await expect(async () => {
        await page.goto(siteUrl(baseURL, SCHOOL_HOSTNAME, `/${slug}`))
        await expect(page.getByText('The first day is Monday.')).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      await expect(page.getByText('The first day is Monday.')).toHaveCSS('text-align', 'center')
      // Right is END: it mirrors in a right-to-left translation.
      await expect(page.getByText('— The principal')).toHaveCSS('text-align', 'end')
      await expect(page.locator('blockquote')).toHaveText('Every student, every day.')
      await expect(page.locator('main hr')).toHaveCount(1)
      await expect(page.getByRole('img', { name: 'The new playground' })).toBeVisible()
      expect(await blocking(page)).toEqual([])
    } finally {
      await admin.delete(`/api/pages/${id}`)
      await admin.delete(`/api/resources/${file}`)
      await admin.dispose()
    }
  })
})

adminTest.describe('the editor’s toolbar', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest(
    '@a11y its buttons are in sight and named; "Insert a line" adds one to the page',
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL)
      try {
        await openPage(page, fixture.id)
        await page.locator('.ContentEditable__root').first().click()
        const toolbar = page.locator('.fixed-toolbar').first()
        for (const name of [
          'Insert an image',
          'Insert a line',
          'Normal text',
          'Heading',
          'Subheading',
          'Bulleted list',
          'Numbered list',
          'Quotation',
          'Align text',
          'Bold',
          'Italic',
        ])
          await expect(toolbar.getByRole('button', { name, exact: true })).toBeVisible()

        await toolbar.getByRole('button', { name: 'Insert a line', exact: true }).click()
        await expect
          .poll(
            async () =>
              JSON.stringify(
                await (
                  await fixture.admin.get(`/api/pages/${fixture.id}?draft=true&depth=0`)
                ).json(),
              ).includes('"horizontalrule"'),
            { timeout: 20_000 },
          )
          .toBe(true)
        expect(await blocking(page)).toEqual([])
      } finally {
        await dropPage(fixture)
      }
    },
  )
})
