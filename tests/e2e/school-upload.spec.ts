import AxeBuilder from '@axe-core/playwright'
import { expect, request as playwrightRequest, type Page } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { followLink } from './support/follow-link'
import { schoolTest } from './support/school-session'

/**
 * "Upload a file" on the school plane (Jason, 2026-11-13): a school's upload to its own library,
 * no approval. From the start screen; the form asks only what the chosen file's kind needs —
 * alt text or "decorative" for an image, the accessibility answer for a document — and says
 * what's missing beside each field. Built, then locked here (CLAUDE.md: admin views are not
 * test-first); the rules are `tests/unit/admin/upload-file.test.ts`.
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

/** A real 2×2 PNG and a real minimal PDF — Payload checks what it is given. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNkYGD4z8DAwMDAwMAAAAgPAQBJpJ4YAAAAAElFTkSuQmCC',
  'base64',
)
const PDF = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj',
    '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj',
    '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>> endobj',
    'xref',
    '0 4',
    '0000000000 65535 f ',
    'trailer <</Size 4 /Root 1 0 R>>',
    'startxref',
    '0',
    '%%EOF',
    '',
  ].join('\n'),
  'latin1',
)

/** The district's view of the library, to check what landed and to clean up. */
const asDistrict = (baseURL: string | undefined) =>
  playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })

schoolTest.describe('a school uploads a file', () => {
  schoolTest.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    schoolTest(
      `@a11y an image from the start screen: alt text asked, then uploaded — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const district = await asDistrict(baseURL)
        const title = uniqueTitle('Science fair')
        try {
          await page.goto('/admin')
          await page.getByRole('link', { name: /^Upload a file/ }).click({ timeout: 20_000 })
          await expect(page).toHaveURL(/\/admin\/upload-file$/)
          await expect(page.getByRole('heading', { name: 'Upload a file', level: 1 })).toBeVisible()

          // Nothing chosen: what's missing, beside each field.
          await page.getByRole('button', { name: 'Upload' }).click()
          await expect(page.getByText('Choose a file to upload.')).toBeVisible()
          await expect(page.getByText('Give the file a title.')).toBeVisible()
          await expect(page.getByLabel('The file')).toBeFocused()
          expect(await blockingViolations(page)).toEqual([])

          // An image: its title starts from the name; it asks for alt text.
          await page.getByLabel('The file').setInputFiles({
            name: 'science-fair.png',
            mimeType: 'image/png',
            buffer: PNG,
          })
          await expect(page.getByLabel('Title')).toHaveValue('science fair')
          await expect(page.getByRole('group', { name: /checked for accessibility/ })).toHaveCount(
            0,
          )
          await page.getByLabel('Title').fill(title)
          await page.getByRole('button', { name: 'Upload' }).click()
          await expect(
            page.getByText(
              'Describe the image for people who can’t see it, or mark it decorative.',
            ),
          ).toBeVisible()
          await expect(page.getByLabel('Describe the image')).toBeFocused()
          expect(await blockingViolations(page)).toEqual([])

          await page.getByLabel('Describe the image').fill('Students showing their volcano')
          await page.getByRole('button', { name: 'Upload' }).click()
          await expect(page.locator('#upload-file').getByRole('status')).toContainText(
            `Uploaded “${title}” to your school’s library.`,
            { timeout: 20_000 },
          )
          expect(await blockingViolations(page)).toEqual([])

          const found = (await (
            await district.get(
              `/api/resources?where[title][equals]=${encodeURIComponent(title)}&depth=1`,
            )
          ).json()) as {
            docs: { id: number; alt: string; kind: string; tenant: { hostname: string } }[]
          }
          expect(found.docs).toHaveLength(1)
          expect(found.docs[0]).toMatchObject({
            alt: 'Students showing their volcano',
            kind: 'image',
            tenant: { hostname: 'a.localhost' },
          })
          await district.delete(`/api/resources/${found.docs[0]!.id}`)
        } finally {
          await district.dispose()
        }
      },
    )
  }

  schoolTest(
    'a document asks whether it was checked for accessibility',
    async ({ page, baseURL }) => {
      const district = await asDistrict(baseURL)
      const title = uniqueTitle('Lunch menu')
      try {
        await page.goto('/admin/upload-file')
        await page.getByLabel('The file').setInputFiles({
          name: 'lunch-menu.pdf',
          mimeType: 'application/pdf',
          buffer: PDF,
        })
        await expect(page.getByLabel('Describe the image')).toHaveCount(0)
        await page.getByLabel('Title').fill(title)
        await page.getByRole('button', { name: 'Upload' }).click()
        await expect(
          page.getByText('Say whether this document has been checked for accessibility.'),
        ).toBeVisible()

        await page.getByLabel('No — not checked yet').check()
        await page.getByRole('button', { name: 'Upload' }).click()
        await expect(page.locator('#upload-file').getByRole('status')).toContainText(
          `Uploaded “${title}”`,
          {
            timeout: 20_000,
          },
        )
        const found = (await (
          await district.get(
            `/api/resources?where[title][equals]=${encodeURIComponent(title)}&depth=0`,
          )
        ).json()) as { docs: { id: number; remediationStatus: string }[] }
        expect(found.docs[0]?.remediationStatus).toBe('not-attested')
        await district.delete(`/api/resources/${found.docs[0]!.id}`)
      } finally {
        await district.dispose()
      }
    },
  )

  schoolTest(
    'the Files list’s “Upload a file” leads here, not to Payload’s screen',
    async ({ page }) => {
      await page.goto('/admin/collections/resources')
      // A list view re-renders after it looks ready; a lone early click can be lost.
      await followLink(
        page,
        page.getByRole('link', { name: 'Upload a file' }),
        /\/admin\/upload-file$/,
      )
    },
  )
})
