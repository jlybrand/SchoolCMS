import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { schoolTest } from './support/school-session'

/**
 * The dashboard icon at the top of the side navigation, both planes (Jason, 2026-11-12). Built,
 * then locked here (CLAUDE.md: admin views are not test-first).
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

/** From another screen, the icon leads home and is marked current there. */
const leadsHome = async (page: Page, from: string, home: string) => {
  await page.goto(from)
  // Payload remembers, per user and on the server, whether the side navigation was left open, and
  // other specs signed in as the same user flip it. So: open it until the link can really be
  // clicked — a trial click fails while the closed nav leaves the page's content on top of it.
  const link = page.locator('#nav-dashboard')
  await expect(async () => {
    const usable = await link
      .click({ trial: true, timeout: 1_000 })
      .then(() => true)
      .catch(() => false)
    if (!usable)
      await page
        .getByRole('button', { name: /^(Open|Close) Menu$/ })
        .first()
        .click()
    await link.click({ trial: true, timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  await expect(link).toHaveAccessibleName('Dashboard')
  await expect(link).not.toHaveAttribute('aria-current', 'page')
  // First in the side navigation: before the tenant filter (district) and every menu link.
  const first = await page.evaluate(() => {
    const icon = document.getElementById('nav-dashboard')
    const rest = document.querySelectorAll('nav a, nav p, .tenant-selector')
    return (
      icon !== null &&
      rest.length > 0 &&
      [...rest].every((el) => Boolean(icon.compareDocumentPosition(el) & 4))
    )
  })
  expect(first).toBe(true)
  await link.click()
  await expect(page).toHaveURL(/\/admin\/?$/)
  await expect(page.locator(home)).toBeVisible({ timeout: 20_000 })
  await expect(link).toHaveAttribute('aria-current', 'page')
}

adminTest.describe('the dashboard icon — district', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest(`@a11y leads home from anywhere`, async ({ page }) => {
    await leadsHome(page, '/admin/collections/pages', '#district-dashboard')
    expect(await blockingViolations(page)).toEqual([])
  })
})

schoolTest.describe('the dashboard icon — school', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest(`@a11y leads to the school's home, above its name`, async ({ page }) => {
    await leadsHome(page, '/admin/collections/pages', '#school-home')
    // Above "Your school".
    const order = await page
      .locator('#nav-dashboard, #nav-school')
      .evaluateAll((els) => els.map((el) => el.id))
    expect(order).toEqual(['nav-dashboard', 'nav-school'])
    expect(await blockingViolations(page)).toEqual([])
  })
})
