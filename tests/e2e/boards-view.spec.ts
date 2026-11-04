import { expect } from '@playwright/test'

import { adminCredentials, adminTest as test } from './support/admin-session'
import { followLink } from './support/follow-link'

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
    const folder = site
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: /^School A \(/ }) })
    await expect(folder).not.toHaveAttribute('open')
    await folder.locator('summary').click()
    await expect(folder).toHaveAttribute('open', '')

    await followLink(
      page,
      folder.getByRole('link', { name: 'News', exact: true }),
      /\/admin\/collections\/post-boards\/\d+$/,
    )
    await expect(page.locator('#field-name')).toHaveValue('News', { timeout: 20_000 })
  })

  test('@smoke post an announcement from the boards screen: the board, its headline, its form', async ({
    page,
  }) => {
    // Board-first, as in Finalsite (Jason, 2026-10-29): the board is chosen here, not on the form.
    await page.goto('/admin/collections/post-boards')
    const site = page.locator('#boards').getByRole('region', { name: 'School A' })
    const folder = site
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: /^School A \(/ }) })
    await expect(folder.locator('summary')).toBeVisible({ timeout: 20_000 })
    await folder.locator('summary').click()
    await expect(folder).toHaveAttribute('open', '')

    // Named in full for a screen reader — every site has a "News".
    await followLink(
      page,
      folder.getByRole('link', { name: 'New announcement on School A · School A → News' }),
      /\/admin\/collections\/posts$/,
    )
    // The announcements screen, on that board, with the headline showing (Jason, 2026-11-04).
    await expect(page.locator('#board-heading')).toHaveText('School A → News', { timeout: 20_000 })
    const view = page.locator('#new-post')
    await expect(view.getByRole('heading', { name: 'New announcement' })).toBeVisible()
    // The board is decided: no choice offered, and no site question from Payload.
    await expect(view.getByRole('radio')).toHaveCount(0)

    const title = `Board-first ${Date.now()}`
    const headline = view.getByLabel('What is the headline?')
    await expect(async () => {
      await headline.fill(title)
      await expect(headline).toHaveValue(title, { timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
    await view.getByRole('button', { name: 'Write the announcement' }).click()
    await page.waitForURL(/\/admin\/collections\/posts\/\d+$/, { timeout: 20_000 })
    const id = new URL(page.url()).pathname.split('/').pop()

    try {
      await expect(page.locator('#field-title')).toHaveValue(title, { timeout: 20_000 })
      // The plugin keeps its site question in the page, hidden; it must not open.
      await expect(page.locator('#assign-tenant-field-modal')).toBeHidden()
      const stored = await page.request.get(`/api/posts/${id}?draft=true&depth=1`)
      const doc = (await stored.json()) as {
        board: { label: string }
        tenant: { name: string }
        _status: string
      }
      expect(doc.board.label).toBe('School A · School A → News')
      expect(doc.tenant.name).toBe('School A')
      // Started, not published: the district publishes from the form, as with any post.
      expect(doc._status).toBe('draft')
    } finally {
      await page.request.delete(`/api/posts/${id}`)
    }
  })

  test('without a board, the old new-announcement address asks the district to choose one', async ({
    page,
  }) => {
    await page.goto('/admin/new-post')
    await expect(page).toHaveURL(/\/admin\/collections\/posts\?new=1/, { timeout: 20_000 })
    await expect(page.locator('#board-heading')).toHaveText('Choose a board', { timeout: 20_000 })
    await expect(page.locator('#new-post')).toHaveCount(0)
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
