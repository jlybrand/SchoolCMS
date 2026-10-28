import { expect } from '@playwright/test'

import { adminCredentials, adminTest as test } from './support/admin-session'

/**
 * The district's boards screen (Jason, 2026-10-28): each site's folders, each opened to pick a
 * board — boards belong to folders. Custom admin React, so locked with a flow here and axe in
 * `admin-planes-axe.spec.ts` (CLAUDE.md's exception table). The grouping is
 * `tests/unit/admin/board-tree.test.ts`.
 */

const credentials = adminCredentials()

test.describe('announcement boards, by folder', () => {
  test.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  test('@smoke open a site’s folder, pick its board, and land on the board', async ({ page }) => {
    await page.goto('/admin/collections/post-boards')
    const view = page.locator('#boards')
    await expect(view.getByRole('heading', { level: 1 })).toHaveText('Announcement boards', {
      timeout: 20_000,
    })

    // The seed gives School A a folder named after it, holding a "News" board.
    const site = view.getByRole('region', { name: 'School A' })
    const folder = site.locator('details').filter({ hasText: 'School A' }).first()
    await expect(folder).not.toHaveAttribute('open')
    await folder.locator('summary').click()
    await expect(folder).toHaveAttribute('open', '')

    await folder.getByRole('link', { name: 'News' }).click()
    await expect(page).toHaveURL(/\/admin\/collections\/post-boards\/\d+$/, { timeout: 20_000 })
    await expect(page.locator('#field-name')).toHaveValue('News', { timeout: 20_000 })
  })

  test('a folder opens and closes from the keyboard', async ({ page }) => {
    await page.goto('/admin/collections/post-boards')
    const summary = page.locator('#boards summary').first()
    await expect(summary).toBeVisible({ timeout: 20_000 })
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#boards details').first()).toHaveAttribute('open', '')
    await page.keyboard.press('Enter')
    await expect(page.locator('#boards details').first()).not.toHaveAttribute('open')
  })

  test('links to add a folder and a board', async ({ page }) => {
    await page.goto('/admin/collections/post-boards')
    const view = page.locator('#boards')
    await expect(view.getByRole('link', { name: 'Add a folder' })).toHaveAttribute(
      'href',
      '/admin/collections/post-folders/create',
    )
    await expect(view.getByRole('link', { name: 'Add a board' })).toHaveAttribute(
      'href',
      /\/admin\/collections\/post-boards\/create/,
    )
  })
})
