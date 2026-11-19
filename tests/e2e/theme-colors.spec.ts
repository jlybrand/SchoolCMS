import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

import { adminCredentials, adminTest as test } from './support/admin-session'

/**
 * A school's colors (Jason, 2026-11-18): ANY color is accepted. The main color as link text is
 * the school's choice — the form WARNS, live, when it is under 4.5:1 as normal-size text, and
 * never refuses. Only a value that is not a color is refused. Built, then locked here (CLAUDE.md:
 * admin views are not test-first).
 *
 * Opened for a site of its own, made before each test and removed after, so it is always the
 * create form and no other spec's theme is touched (as `settings-fields.spec.ts`).
 */

const credentials = adminCredentials()
const BLOCKING = ['critical', 'serious']

const blockingViolations = async (page: Page) =>
  (
    await new AxeBuilder({ page })
      .include('.document-fields')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
  ).violations
    .filter((v) => BLOCKING.includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)

test.describe('the theme form', () => {
  test.skip(credentials === null, 'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env.')

  let site: { id: number } | null = null

  test.beforeEach(async ({ page, baseURL }) => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const made = await page.request.post('/api/tenants?depth=0', {
      data: {
        name: `Theme spec ${stamp}`,
        slug: `theme-spec-${stamp}`,
        hostname: `theme-spec-${stamp}.localhost`,
        type: 'school',
      },
    })
    expect(made.ok(), await made.text()).toBe(true)
    site = ((await made.json()) as { doc: { id: number } }).doc
    await page
      .context()
      .addCookies([{ name: 'payload-tenant', value: String(site.id), url: baseURL ?? '' }])
    await page.goto('/admin/collections/theme/create')
  })

  test.afterEach(async ({ page }) => {
    if (site === null) return
    await page.request.delete(`/api/theme?where[tenant][equals]=${site.id}`)
    const gone = await page.request.delete(`/api/tenants/${site.id}`)
    expect(gone.ok(), `remove the spec's own site: ${await gone.text()}`).toBe(true)
    site = null
  })

  test(`@a11y a low-contrast main color is WARNED about, and saved`, async ({ page }) => {
    const main = page.locator('[name="primaryColor"]')
    await expect(main).toBeEnabled({ timeout: 20_000 })
    const note = page.locator('#brand-contrast-note')

    // #1e891e: 4.5:1 on white, under it on the light-grey panels — the case that was refused.
    await main.fill('#1e891e')
    await expect(note).toContainText('the light-grey panels (4.2:1)')
    await expect(note).toContainText('Large or bold text needs only 3:1')
    await expect(note).not.toContainText('white page')
    expect(await blockingViolations(page)).toEqual([])

    // A warning, not a refusal: it saves.
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page).toHaveURL(/\/collections\/theme\/\d+/, { timeout: 20_000 })
    await expect(page.locator('.field-error, .tooltip--error')).toHaveCount(0)

    // A dark color: nothing to say.
    await main.fill('#0f4c81')
    await expect(note).toHaveText('')
  })

  test('refuses a value that is not a color, and says how to write one', async ({ page }) => {
    const main = page.locator('[name="primaryColor"]')
    await expect(main).toBeEnabled({ timeout: 20_000 })
    await main.fill('green')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByText('Enter the color as a # followed by six letters or numbers, like #0f4c81.'),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/theme\/create/)
  })
})
