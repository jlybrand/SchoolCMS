import AxeBuilder from '@axe-core/playwright'
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, adminTest } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { schoolTest, tenantIdFor } from './support/school-session'

/**
 * The platform's brand in the admin (Jason, 2026-11-18: white-label the platform, not per
 * school): its fixed logo on the sign-in screen and its mark as the breadcrumb's home link; a
 * band atop both start screens with the district site's logo (its Settings) and the platform's
 * name — a school's own name on a school manager's; and the district's colors on primary buttons and the current menu item — primary in the
 * light theme, secondary in the dark. Built, then locked here (CLAUDE.md: admin views are not
 * test-first); axe in both themes is what holds the colors to AA.
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

/** The image has really loaded — not a broken link with alt text standing in for it. */
const loaded = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate(
      (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
    )

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNkYGD4z8DAwMDAwMAAAAgPAQBJpJ4YAAAAAElFTkSuQmCC',
  'base64',
)

const ACCENT = { light: 'rgb(43, 49, 112)', dark: 'rgb(153, 161, 231)' } as const
const ON_ACCENT = { light: 'rgb(255, 255, 255)', dark: 'rgb(20, 24, 61)' } as const

test.describe('the sign-in screen', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@a11y carries the platform’s logo — ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await page.goto('/admin/login')
      const logo = page.getByRole('img', { name: 'DD2 Websites' })
      await expect(logo).toBeVisible({ timeout: 20_000 })
      expect(await loaded(page, 'img[alt="DD2 Websites"]')).toBe(true)
      await expect(page).toHaveTitle(/DD2 Websites/)
      // A primary button in the district's accent: primary in the light theme, secondary in the
      // dark. Signed out, Payload takes the theme from a cookie, not the system, so the page says
      // which it is showing.
      const theme =
        (await page.locator('html').getAttribute('data-theme')) === 'dark' ? 'dark' : 'light'
      const login = page.locator('.btn--style-primary').first()
      await expect(login).toHaveCSS('background-color', ACCENT[theme])
      await expect(login).toHaveCSS('color', ON_ACCENT[theme])
      expect(await blockingViolations(page)).toEqual([])
    })
  }
})

adminTest.describe('the district’s start screen', () => {
  adminTest.skip(credentials === null, SKIP)
  // One district, one Settings logo: the light and dark passes would set it over each other.
  adminTest.describe.configure({ mode: 'serial' })

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(
      `@a11y the brand band, the district’s logo from its Settings, and its colors — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const admin = await playwrightRequest.newContext({
          ...(baseURL ? { baseURL } : {}),
          storageState: ADMIN_STORAGE_STATE,
        })
        const district = await tenantIdFor(admin, 'localhost')
        const alt = uniqueTitle('Dakota District 2')
        const made = await admin.post('/api/resources?depth=0', {
          multipart: {
            file: { name: `district-logo-${Date.now()}.png`, mimeType: 'image/png', buffer: PNG },
            _payload: JSON.stringify({ tenant: district, title: 'District logo', alt }),
          },
        })
        expect(made.ok(), await made.text()).toBe(true)
        const logo = ((await made.json()) as { doc: { id: number } }).doc.id
        const rows = (await (
          await admin.get(`/api/settings?where[tenant][equals]=${district}&limit=1&depth=0`)
        ).json()) as { docs: { id: number; logo?: number | null }[] }
        const settings = rows.docs[0]
        const before = settings?.logo ?? null
        const set = settings
          ? await admin.patch(`/api/settings/${settings.id}?depth=0`, { data: { logo } })
          : await admin.post('/api/settings?depth=0', { data: { tenant: district, logo } })
        expect(set.ok(), await set.text()).toBe(true)
        // Made here when the district had none: removed after, so the settings spec finds none.
        const createdId = settings ? null : ((await set.json()) as { doc: { id: number } }).doc.id
        try {
          await page.goto('/admin')
          const band = page.locator('#brand-band')
          await expect(band).toContainText('DD2 Websites', { timeout: 20_000 })
          // Above the screen's own heading, and not one itself.
          await expect(band.getByRole('heading')).toHaveCount(0)
          await expect(band.getByRole('img', { name: alt })).toBeVisible()
          expect(await loaded(page, '#brand-band img')).toBe(true)

          // The platform's mark is the breadcrumb's home link, named for where it goes.
          const home = page.locator('.step-nav__home')
          if ((await home.count()) > 0) {
            await expect(home).toHaveAccessibleName('Dashboard')
            expect(await loaded(page, '.step-nav__home img')).toBe(true)
          }

          // The district's colors: the current menu item in the accent, per theme.
          await page.goto('/admin/collections/users')
          const current = page.locator('#nav-menu-users')
          await expect(current).toHaveAttribute('aria-current', 'page', { timeout: 20_000 })
          await expect(current).toHaveCSS('color', ACCENT[colorScheme])

          await page.goto('/admin')
          await expect(band).toBeVisible({ timeout: 20_000 })
          expect(await blockingViolations(page)).toEqual([])
        } finally {
          if (createdId !== null) await admin.delete(`/api/settings/${createdId}`)
          else
            await admin.patch(`/api/settings/${settings!.id}?depth=0`, { data: { logo: before } })
          await admin.delete(`/api/resources/${logo}`)
          await admin.dispose()
        }
      },
    )
  }
})

schoolTest.describe('a school manager’s start screen', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest(
    '@a11y carries the band, with their school’s name (Jason, 2026-11-18)',
    async ({ page }) => {
      await page.goto('/admin')
      const band = page.locator('#school-home #brand-band')
      await expect(band).toContainText('School A', { timeout: 20_000 })
      await expect(band).not.toContainText('DD2 Websites')
      await expect(
        page.getByRole('heading', { level: 1, name: 'What would you like to do?' }),
      ).toBeVisible()
      expect(await blockingViolations(page)).toEqual([])
    },
  )
})
