import { expect } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'

/**
 * The file library in the district's admin (Jason, 2026-11-13): "Upload a file", never "Create
 * New"; an image without alt text is refused at upload, with the reason beside the field (CLAUDE.md rule 7), and goes in once it is
 * described. Built, then locked here; the rules are `tests/unit/lib/resources.test.ts` and
 * `tests/integration/resources.test.ts`; whole-screen axe is `admin-planes-axe.spec.ts`.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

/** A real 2×2 PNG — Payload checks what it is given. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNkYGD4z8DAwMDAwMAAAAgPAQBJpJ4YAAAAAElFTkSuQmCC',
  'base64',
)

adminTest.describe('uploading to the file library', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest(
    'an image is refused without alt text, and goes in once described',
    async ({ page }) => {
      const title = uniqueTitle('Science fair')
      let id: number | null = null
      try {
        // Files are uploaded, not "created" (Jason, 2026-11-13) — on the list and the new file.
        await page.goto('/admin/collections/resources')
        await expect(page.getByRole('link', { name: 'Upload a file' })).toBeVisible({
          timeout: 20_000,
        })
        await expect(page.getByRole('link', { name: /create new/i })).toBeHidden()
        await page.getByRole('link', { name: 'Upload a file' }).click()
        await expect(page).toHaveURL(/\/resources\/create/)
        await expect(page.getByText('Uploading a file', { exact: true })).toBeVisible()
        await expect(page.getByText(/creating new/i)).toBeHidden()
        // The breadcrumb's last step says it too (generated content, so read the computed text).
        expect(
          await page
            .locator('.step-nav__last')
            .evaluate((el) => getComputedStyle(el, '::after').content),
        ).toBe('"Upload a file"')

        // The district works across sites, so Payload's multi-tenant plugin asks whose file it is.
        const site = page.getByRole('combobox', { name: 'Assigned Tenant' })
        await site.click({ timeout: 20_000 })
        await page.getByRole('option', { name: 'School A' }).click()
        await page.getByRole('button', { name: 'Confirm' }).click()
        await expect(site).toBeHidden()

        await page.locator('input[type="file"]').setInputFiles({
          name: `fair-${Date.now()}.png`,
          mimeType: 'image/png',
          buffer: PNG,
        })
        await page.locator('#field-title').fill(title)
        await page.locator('#action-save').click()
        await expect(
          page.getByText('Describe the image for people who can’t see it, or mark it decorative.'),
        ).toBeVisible({ timeout: 20_000 })
        await expect(page).toHaveURL(/\/resources\/create/)

        await page.locator('#field-alt').fill('Students showing their volcano at the science fair')
        await page.locator('#action-save').click()
        await expect(page).toHaveURL(/\/admin\/collections\/resources\/\d+$/, { timeout: 20_000 })
        id = Number(/\/resources\/(\d+)$/.exec(page.url())?.[1])

        const saved = (await (await page.request.get(`/api/resources/${id}?depth=0`)).json()) as {
          kind: string
          alt: string
        }
        expect(saved).toMatchObject({
          kind: 'image',
          alt: 'Students showing their volcano at the science fair',
        })
      } finally {
        if (id !== null) await page.request.delete(`/api/resources/${id}`)
      }
    },
  )
})
