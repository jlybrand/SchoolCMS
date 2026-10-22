import { expect, request as playwrightRequest } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, adminTest } from './support/admin-session'
import {
  dropPage,
  expectNoBlockingViolations,
  makePage,
  uniqueTitle,
} from './support/fixture-pages'
import { schoolTest as test } from './support/school-session'

/**
 * The school plane's home screen and its two tasks (`04` §2.2, §2.4).
 *
 * The lock-in CLAUDE.md's exception table requires for custom admin React: the flows a school
 * manager takes, plus axe over each view in both Payload themes. The pure decisions — tasks,
 * page types, form checks, error wording — are `tests/unit/admin/school-plane.test.ts`.
 *
 * Fixture pages are made by the district admin and deleted after; pages this spec CREATES
 * through the form are deleted by id from the URL it lands on.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

const deleteCreated = async (baseURL: string | undefined, url: string) => {
  const id = /\/collections\/pages\/(\d+)/.exec(url)?.[1]
  if (!id) return
  const admin = await playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })
  await admin.delete(`/api/pages/${id}`)
  await admin.dispose()
}

test.describe('school plane — home', () => {
  test.skip(credentials === null, SKIP)

  test('@smoke greets with tasks named as verbs, not collections', async ({ page }) => {
    await page.goto('/admin')
    const home = page.locator('#school-home')
    await expect(home.getByRole('heading', { level: 1 })).toHaveText('What would you like to do?', {
      timeout: 20_000,
    })
    await expect(home.getByRole('link', { name: /Update a page/ })).toBeVisible()
    await expect(home.getByRole('link', { name: /Add a page/ })).toBeVisible()
    await expect(home).not.toContainText(/collection|draft|publish/i)
    await expect(home.getByRole('heading', { name: 'Your recent submissions' })).toBeVisible()
  })

  test('a page they sent appears under recent submissions with its status', async ({
    page,
    baseURL,
  }) => {
    const fixture = await makePage(baseURL, { title: uniqueTitle('Lunch menu') })
    try {
      const sent = await page.request.patch(`/api/pages/${fixture.id}?draft=true`, {
        data: { reviewState: 'submitted' },
      })
      expect(sent.ok(), await sent.text()).toBe(true)

      await page.goto('/admin')
      const row = page.locator('#school-home li').filter({ hasText: fixture.title })
      await expect(row).toContainText('Sent for approval', { timeout: 20_000 })
      await row.getByRole('link', { name: fixture.title }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/collections/pages/${fixture.id}`))
    } finally {
      await dropPage(fixture)
    }
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@smoke @a11y has zero critical or serious axe violations — ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme })
      await page.goto('/admin')
      await expect(page.locator('#school-home h1')).toBeVisible({ timeout: 20_000 })
      await expectNoBlockingViolations(page, '#school-home')
    })
  }
})

test.describe('school plane — update a page', () => {
  test.skip(credentials === null, SKIP)

  test('@smoke lists their school’s pages and never another school’s', async ({
    page,
    baseURL,
  }) => {
    const mine = await makePage(baseURL, { title: uniqueTitle('Our library') })
    const theirs = await makePage(baseURL, {
      title: uniqueTitle('Another school library'),
      hostname: 'b.localhost',
    })
    try {
      await page.goto('/admin')
      await page.getByRole('link', { name: /Update a page/ }).click()
      const view = page.locator('#update-page')
      await expect(view.getByRole('heading', { level: 1 })).toHaveText(
        'Which page do you want to update?',
        { timeout: 20_000 },
      )
      await expect(view.getByRole('link', { name: mine.title })).toBeVisible()
      await expect(view.getByText(theirs.title)).toHaveCount(0)

      await view.getByRole('link', { name: mine.title }).click()
      await expect(page.locator('#field-title')).toHaveValue(mine.title, { timeout: 20_000 })
    } finally {
      await dropPage(mine)
      await dropPage(theirs)
    }
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@a11y has zero critical or serious axe violations — ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await page.goto('/admin/update-page')
      await expect(page.locator('#update-page h1')).toBeVisible({ timeout: 20_000 })
      await expectNoBlockingViolations(page, '#update-page')
    })
  }
})

test.describe('school plane — add a page', () => {
  test.skip(credentials === null, SKIP)

  test('@smoke asks for a title and a kind, creates the page, and opens it ready to edit', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: /Add a page/ }).click()
    const view = page.locator('#new-page')
    await expect(view.getByRole('heading', { level: 1 })).toHaveText('Add a page', {
      timeout: 20_000,
    })

    // Nothing filled in: both problems, in words, and focus on the first.
    const create = view.getByRole('button', { name: 'Create the page' })
    await expect(async () => {
      await create.click()
      await expect(view.getByText('Give the page a title.')).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
    await expect(view.getByText('Choose what kind of page this is.')).toBeVisible()
    const title = view.getByLabel('What is this page called?')
    await expect(title).toBeFocused()
    await expect(title).toHaveAttribute('aria-invalid', 'true')

    const pageTitle = uniqueTitle('Field trip forms')
    await title.fill(pageTitle)
    await view.getByRole('radio', { name: /Forms and documents/ }).check()
    await create.click()

    await page.waitForURL(/\/admin\/collections\/pages\/\d+/, { timeout: 20_000 })
    try {
      await expect(page.locator('#field-title')).toHaveValue(pageTitle, { timeout: 20_000 })
      await expect(page.locator('#review-status')).toContainText('Your changes save automatically')
      await expect(
        page.locator('.doc-controls').getByRole('button', { name: 'Send for approval' }),
      ).toBeVisible()
    } finally {
      await deleteCreated(baseURL, page.url())
    }
  })

  test('a title already in use is explained as a title problem', async ({ page, baseURL }) => {
    // Created the way the form creates, so its slug is the one this title makes. (A slug changed
    // by a later DRAFT save would not do: drafts are versions, and the check reads pages.)
    const existing = await makePage(baseURL, { title: uniqueTitle('Bus routes'), slug: null })
    try {
      await page.goto('/admin/new-page')
      const view = page.locator('#new-page')
      const title = view.getByLabel('What is this page called?')
      await expect(title).toBeEditable({ timeout: 20_000 })
      await expect(async () => {
        await title.fill(existing.title)
        await view.getByRole('radio', { name: /General page/ }).check()
        await view.getByRole('button', { name: 'Create the page' }).click()
        await expect(view.getByRole('alert')).toHaveText(
          'There is already a page with this title. Try a different title.',
          { timeout: 5_000 },
        )
      }).toPass({ timeout: 20_000 })
      await expect(page).toHaveURL(/\/admin\/new-page/)
    } finally {
      await dropPage(existing)
    }
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@a11y has zero critical or serious axe violations, errors showing — ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme })
      await page.goto('/admin/new-page')
      const view = page.locator('#new-page')
      await expect(async () => {
        await view.getByRole('button', { name: 'Create the page' }).click()
        await expect(view.getByText('Give the page a title.')).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 20_000 })
      await expectNoBlockingViolations(page, '#new-page')
    })
  }
})

adminTest.describe('school plane — the district is unchanged', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest('@smoke the district admin keeps Payload’s dashboard', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.locator('.dashboard')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('#school-home')).toHaveCount(0)
  })

  adminTest('the school task views send a district admin home', async ({ page }) => {
    for (const path of ['/admin/new-page', '/admin/update-page']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 20_000 })
    }
  })
})
