import { expect, request as playwrightRequest, type Page } from '@playwright/test'

import { adminCredentials } from './support/admin-session'
import {
  dropPage,
  expectNoBlockingViolations,
  makePage,
  uniqueTitle,
} from './support/fixture-pages'
import { SCHOOL_STORAGE_STATE, schoolTest } from './support/school-session'

/**
 * Live Preview (Jason, 2026-11-10): the page as it will look, beside its form, following the
 * editor's typing. The access rule — a draft is read as the person previewing — is
 * `tests/integration/page-preview.test.ts`; this is the screen, by keyboard, under axe.
 *
 * Payload remembers the panel per person. Every test closes it again, so it never leaks open
 * into another spec's form.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

const toggle = (page: Page) => page.getByRole('button', { name: 'Live Preview' })
const preview = (page: Page) => page.frameLocator('#live-preview-iframe')

/** Payload hides the frame when the panel closes; it does not remove it. */
const frameShown = (page: Page) => page.locator('#live-preview-iframe:visible')

const openPreview = async (page: Page) => {
  await expect(toggle(page)).toBeVisible({ timeout: 20_000 })
  if ((await frameShown(page).count()) === 0) {
    await toggle(page).focus()
    await page.keyboard.press('Enter')
  }
  await expect(frameShown(page)).toHaveCount(1, { timeout: 20_000 })
  // A screen reader hears that it is on (`A11yPatch`).
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
}

const closePreview = async (page: Page) => {
  if ((await frameShown(page).count()) > 0) await toggle(page).click()
  await expect(frameShown(page)).toHaveCount(0)
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
}

schoolTest.describe('Live Preview — a school manager', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest(
    '@smoke opens by keyboard, shows the page in its site, and follows the typing',
    async ({ page, baseURL }) => {
      const title = uniqueTitle('Field trip')
      const fixture = await makePage(baseURL, { title })
      try {
        await page.goto(`/admin/collections/pages/${fixture.id}`)
        await openPreview(page)
        try {
          // The site's own frame: its header, the page title as the h1, the words.
          await expect(preview(page).locator('h1')).toHaveText(title, { timeout: 20_000 })
          await expect(preview(page).locator('header').first()).toContainText('School A')
          await expect(preview(page).locator('main')).toContainText('Forms are due Friday.')

          // Typed in the form, by keyboard; the preview follows on the autosave.
          const editor = page.locator('#field-layout .ContentEditable__root').first()
          await editor.click()
          await page.keyboard.press('Control+End')
          await page.keyboard.type(' Bring a lunch.')
          await expect(preview(page).locator('main')).toContainText('Bring a lunch.', {
            timeout: 20_000,
          })
        } finally {
          await closePreview(page)
        }
      } finally {
        await dropPage(fixture)
      }
    },
  )

  schoolTest(
    'device tabs: opens on Desktop, and Mobile, Tablet and Responsive resize it (2026-11-12)',
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL, { title: uniqueTitle('Device tabs') })
      try {
        await page.goto(`/admin/collections/pages/${fixture.id}`)
        await openPreview(page)
        try {
          const tabs = page.getByRole('group', { name: 'Preview size' })
          await expect(tabs.getByRole('button')).toHaveText([
            'Mobile',
            'Tablet',
            'Desktop',
            'Responsive',
          ])
          // Payload's own dropdown is gone; its width box stays and says the size.
          await expect(page.locator('.live-preview-toolbar-controls__breakpoint')).toBeHidden()
          const width = page.locator('input[name="live-preview-width"]')
          const pick = (name: string) => tabs.getByRole('button', { name, exact: true })

          await expect(pick('Desktop')).toHaveAttribute('aria-pressed', 'true')
          await expect(width).toHaveValue('1280')
          for (const [name, px] of [
            ['Mobile', '375'],
            ['Tablet', '768'],
            ['Desktop', '1280'],
          ] as const) {
            await pick(name).click()
            await expect(pick(name)).toHaveAttribute('aria-pressed', 'true')
            await expect(width).toHaveValue(px)
          }
          // Fitted to the pane (Jason, 2026-11-12): the whole device shows, laid out at its own width.
          for (const [name, px] of [
            ['Desktop', 1280],
            ['Tablet', 768],
          ] as const) {
            await pick(name).click()
            await expect(async () => {
              const pane = await page.locator('.live-preview-window__main').boundingBox()
              const frame = await page.locator('#live-preview-iframe').boundingBox()
              expect(frame!.x + frame!.width).toBeLessThanOrEqual(pane!.x + pane!.width)
              const laidOut = await preview(page)
                .locator('html')
                .evaluate(() => window.innerWidth)
              expect(Math.abs(laidOut - px)).toBeLessThanOrEqual(1)
            }).toPass({ timeout: 10_000 })
          }

          await pick('Responsive').click()
          await expect(pick('Responsive')).toHaveAttribute('aria-pressed', 'true')
          await expect(pick('Desktop')).toHaveAttribute('aria-pressed', 'false')
        } finally {
          await closePreview(page)
        }
      } finally {
        await dropPage(fixture)
      }
    },
  )

  for (const colorScheme of ['light', 'dark'] as const) {
    schoolTest(
      `@a11y the page form with the preview open — ${colorScheme}`,
      async ({ page, baseURL }) => {
        const fixture = await makePage(baseURL, { title: uniqueTitle('Axe preview') })
        try {
          await page.emulateMedia({ colorScheme })
          await page.goto(`/admin/collections/pages/${fixture.id}`)
          await openPreview(page)
          try {
            await expect(preview(page).locator('h1')).toBeVisible({ timeout: 20_000 })
            // The repairs (`A11yPatch`) have landed before anything is audited.
            await expect(page.locator('#live-preview-iframe[title="Page preview"]')).toBeAttached()
            await expect(
              page.locator('input[name="live-preview-width"][aria-label]'),
            ).toBeAttached()
            await expectNoBlockingViolations(page, 'body')
          } finally {
            await closePreview(page)
          }
        } finally {
          await dropPage(fixture)
        }
      },
    )
  }
})

schoolTest.describe('Live Preview — who sees a draft', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('another school’s page, and no one signed in, get a 404', async ({ baseURL }) => {
    const theirs = await makePage(baseURL, {
      title: uniqueTitle('Not yours'),
      hostname: 'b.localhost',
    })
    const school = await playwrightRequest.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: SCHOOL_STORAGE_STATE,
    })
    const nobody = await playwrightRequest.newContext({ ...(baseURL ? { baseURL } : {}) })
    try {
      expect((await school.get(`/admin-preview/pages/${theirs.id}`)).status()).toBe(404)
      expect((await nobody.get(`/admin-preview/pages/${theirs.id}`)).status()).toBe(404)
      // The district sees it.
      expect((await theirs.admin.get(`/admin-preview/pages/${theirs.id}`)).status()).toBe(200)
    } finally {
      await school.dispose()
      await nobody.dispose()
      await dropPage(theirs)
    }
  })
})
