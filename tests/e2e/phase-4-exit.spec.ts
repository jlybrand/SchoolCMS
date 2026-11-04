import { expect, request as playwrightRequest, type Locator, type Page } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { SCHOOL_HOSTNAME, schoolTest as test } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * THE PHASE 4 EXIT CRITERION (`05`), as one journey:
 *
 *   a school manager creates a page, sends it for approval, cannot publish by any route; the
 *   district approves from a diff in one click and it goes live within seconds.
 *
 * Driven by KEYBOARD ONLY on both planes — `04` §6 makes keyboard-only completion a release
 * check, and `04` §9.6 asks it of both admin planes. No `click`, no `fill`, no `check`: focus
 * moves with Tab and Shift+Tab, and Enter, Space and typing do the rest. Each step asserts that
 * focus is visible where it lands (`2.4.7`).
 *
 * "Any route" is proven in depth elsewhere — REST, Local API and bulk in
 * `tests/integration/tenant-isolation.test.ts`, GraphQL in `tests/integration/graphql.test.ts`.
 * Here the school's own session tries the obvious one, mid-journey, on the page it just made.
 */

const credentials = adminCredentials()

/**
 * Tab until `target` has focus, as a keyboard user would. Fails if it is never reached — that
 * is the bug this check exists to find (a control that only a mouse can operate).
 */
const tabTo = async (page: Page, target: Locator, max = 250) => {
  await expect(target).toBeVisible({ timeout: 20_000 })
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      // Visible focus: the browser's ring or the admin's own outline/box-shadow.
      const visible = await target.evaluate((el) => {
        const style = getComputedStyle(el)
        return (
          el.matches(':focus-visible') &&
          ((style.outlineStyle !== 'none' && style.outlineWidth !== '0px') ||
            style.boxShadow !== 'none')
        )
      })
      expect(visible, 'focus is visible where the keyboard lands').toBe(true)
      return
    }
    await page.keyboard.press('Tab')
  }
  throw new Error(`Never reached by Tab within ${max} presses: ${target}`)
}

test.describe('Phase 4 exit — keyboard only, both planes', () => {
  test.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  test('@smoke a school creates and sends a page; the district approves it from the diff; it is live within seconds', async ({
    page,
    browser,
    baseURL,
  }) => {
    const title = uniqueTitle('Winter concert')
    const admin = await playwrightRequest.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: ADMIN_STORAGE_STATE,
    })
    const district = await browser.newContext({ storageState: ADMIN_STORAGE_STATE })
    let pageId: string | undefined

    try {
      // ── The school plane ────────────────────────────────────────────────────────────────
      await page.goto('/admin')
      await tabTo(page, page.getByRole('link', { name: /Add a page/ }))
      await page.keyboard.press('Enter')

      const form = page.locator('#new-page')
      const titleField = form.getByLabel('What is this page called?')
      await expect(titleField).toBeEditable({ timeout: 20_000 })
      await tabTo(page, titleField)
      await page.keyboard.type(title)

      await tabTo(page, form.getByRole('button', { name: 'Create the page' }))
      await page.keyboard.press('Enter')

      await page.waitForURL(/\/admin\/collections\/pages\/\d+/, { timeout: 20_000 })
      pageId = /\/collections\/pages\/(\d+)/.exec(page.url())![1]
      await expect(page.locator('#field-title')).toHaveValue(title, { timeout: 20_000 })

      const send = page.locator('.doc-controls').getByRole('button', { name: 'Send for approval' })
      await expect(send).toBeEnabled({ timeout: 20_000 })
      await tabTo(page, send)
      await page.keyboard.press('Enter')
      await expect(
        page.getByRole('status').filter({ hasText: /^Sent for approval on / }),
      ).toBeVisible({ timeout: 15_000 })

      // ── It cannot publish ───────────────────────────────────────────────────────────────
      const published = await page.request.patch(`/api/pages/${pageId}`, {
        data: { _status: 'published' },
      })
      expect(published.status(), 'the school publishing its own page').toBe(403)

      const stored = (await (
        await admin.get(`/api/pages/${pageId}?draft=true&depth=0`)
      ).json()) as { slug: string; reviewState: string; _status: string }
      expect(stored.reviewState).toBe('submitted')
      expect(stored._status).toBe('draft')

      const live = siteUrl(baseURL, SCHOOL_HOSTNAME, stored.slug)
      expect((await page.request.get(live)).status(), 'not live before approval').toBe(404)

      // ── The district plane ──────────────────────────────────────────────────────────────
      const reviewer = await district.newPage()
      await reviewer.goto('/admin')
      await tabTo(reviewer, reviewer.getByRole('link', { name: 'Open the approval queue' }))
      await reviewer.keyboard.press('Enter')

      const item = reviewer.getByRole('article', { name: title })
      await expect(item).toBeVisible({ timeout: 20_000 })
      // The diff is right there — no document to open.
      await expect(item.getByRole('row', { name: /^Title/ })).toContainText(title)

      // ONE action from the diff.
      await tabTo(reviewer, item.getByRole('button', { name: 'Approve and publish' }))
      const approvedAt = Date.now()
      await reviewer.keyboard.press('Enter')
      await expect(item.getByRole('status')).toContainText('Published', { timeout: 15_000 })
      await expect(item.getByRole('status')).toBeFocused()

      // ── Live within seconds ─────────────────────────────────────────────────────────────
      await expect
        .poll(async () => (await page.request.get(live)).status(), {
          timeout: 15_000,
          message: 'the approved page reaches the school site within seconds',
        })
        .toBe(200)
      expect(await (await page.request.get(live)).text()).toContain(title)
      test.info().annotations.push({
        type: 'approve-to-live',
        description: `${Date.now() - approvedAt} ms`,
      })
    } finally {
      if (pageId) await admin.delete(`/api/pages/${pageId}`)
      await admin.dispose()
      await district.close()
    }
  })
})
