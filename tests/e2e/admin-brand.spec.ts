import AxeBuilder from '@axe-core/playwright'
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, adminTest } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { SCHOOL_HOSTNAME, schoolTest, tenantIdFor } from './support/school-session'

/**
 * The platform's brand in the admin (Jason, 2026-11-18: white-label the platform, not per
 * school): its fixed logo on the sign-in screen and its mark as the breadcrumb's home link; a
 * band atop both start screens with the district site's logo (its Settings) and the platform's
 * name — a school's own name on a school manager's; and the district's colors: primary on
 * primary buttons, and the side menu on primary with its current item in secondary. Light only —
 * no dark mode, whatever the system asks (Jason, 2026-11-18). Built, then locked here
 * (CLAUDE.md: admin views are not test-first); axe is what holds the colors to AA.
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

const PRIMARY = 'rgb(43, 49, 112)'
const SECONDARY = 'rgb(153, 161, 231)'
const WHITE = 'rgb(255, 255, 255)'

test.describe('the sign-in screen', () => {
  test(`@a11y carries the platform’s logo`, async ({ page }) => {
    await page.goto('/admin/login')
    const logo = page.getByRole('img', { name: 'DDTwo Websites' })
    await expect(logo).toBeVisible({ timeout: 20_000 })
    expect(await loaded(page, 'img[alt="DDTwo Websites"]')).toBe(true)
    await expect(page).toHaveTitle(/DDTwo Websites/)
    // A primary button in the district's primary.
    const login = page.locator('.btn--style-primary').first()
    await expect(login).toHaveCSS('background-color', PRIMARY)
    await expect(login).toHaveCSS('color', WHITE)
    expect(await blockingViolations(page)).toEqual([])
  })
})

/** Light only (Jason, 2026-11-18): a system set to dark changes nothing, and nobody can choose it. */
adminTest('a dark system still gets the light admin, with no theme to choose', async ({ page }) => {
  adminTest.skip(credentials === null, SKIP)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/admin/account')
  await expect(page.locator('#field-email')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('radio', { name: 'Dark' })).toHaveCount(0)
  await expect(page.locator('html')).toHaveCSS('background-color', WHITE)
})

adminTest.describe('the district’s start screen', () => {
  adminTest.skip(credentials === null, SKIP)
  adminTest(
    `@a11y the brand band, the district’s logo from its Settings, and its colors`,
    async ({ page, baseURL }) => {
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
        await expect(band).toContainText('DDTwo Websites', { timeout: 20_000 })
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

        // The district's colors: the side menu on primary, its current item in secondary.
        await page.goto('/admin/collections/users')
        const current = page.locator('#nav-menu-users')
        await expect(current).toHaveAttribute('aria-current', 'page', { timeout: 20_000 })
        await expect(current).toHaveCSS('color', SECONDARY)
        await expect(page.locator('.nav')).toHaveCSS('background-color', PRIMARY)

        await page.goto('/admin')
        await expect(band).toBeVisible({ timeout: 20_000 })
        expect(await blockingViolations(page)).toEqual([])
      } finally {
        if (createdId !== null) await admin.delete(`/api/settings/${createdId}`)
        else await admin.patch(`/api/settings/${settings!.id}?depth=0`, { data: { logo: before } })
        await admin.delete(`/api/resources/${logo}`)
        await admin.dispose()
      }
    },
  )
})

schoolTest.describe('a school manager’s start screen', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest(
    '@a11y carries the band, with their school’s name (Jason, 2026-11-18)',
    async ({ page }) => {
      await page.goto('/admin')
      const band = page.locator('#school-home #brand-band')
      await expect(band).toContainText('School A', { timeout: 20_000 })
      await expect(band).not.toContainText('DDTwo Websites')
      await expect(
        page.getByRole('heading', { level: 1, name: 'What would you like to do?' }),
      ).toBeVisible()
      expect(await blockingViolations(page)).toEqual([])
    },
  )
  schoolTest(
    '@a11y their school’s own logo, larger, and its two colors on the underline (Jason, 2026-11-19)',
    async ({ page, baseURL }) => {
      const admin = await playwrightRequest.newContext({
        ...(baseURL ? { baseURL } : {}),
        storageState: ADMIN_STORAGE_STATE,
      })
      const school = await tenantIdFor(admin, SCHOOL_HOSTNAME)
      const alt = uniqueTitle('School A crest')
      const made = await admin.post('/api/resources?depth=0', {
        multipart: {
          file: { name: `school-logo-${Date.now()}.png`, mimeType: 'image/png', buffer: PNG },
          _payload: JSON.stringify({ tenant: school, title: 'School A logo', alt }),
        },
      })
      expect(made.ok(), await made.text()).toBe(true)
      const logo = ((await made.json()) as { doc: { id: number } }).doc.id

      // Set on School A's own rows — made when it has none, put back (or removed) after.
      const setRow = async (collection: 'settings' | 'theme', data: Record<string, unknown>) => {
        const rows = (await (
          await admin.get(`/api/${collection}?where[tenant][equals]=${school}&limit=1&depth=0`)
        ).json()) as { docs: ({ id: number } & Record<string, unknown>)[] }
        const row = rows.docs[0]
        const res = row
          ? await admin.patch(`/api/${collection}/${row.id}?depth=0`, { data })
          : await admin.post(`/api/${collection}?depth=0`, { data: { tenant: school, ...data } })
        expect(res.ok(), await res.text()).toBe(true)
        const id = row ? row.id : ((await res.json()) as { doc: { id: number } }).doc.id
        const before = Object.fromEntries(Object.keys(data).map((k) => [k, row?.[k] ?? null]))
        return () =>
          row
            ? admin.patch(`/api/${collection}/${id}?depth=0`, { data: before })
            : admin.delete(`/api/${collection}/${id}`)
      }
      const restore: (() => Promise<unknown>)[] = []
      try {
        restore.push(await setRow('settings', { logo }))
        restore.push(await setRow('theme', { primaryColor: '#14532d', secondaryColor: '#ffcc00' }))

        await page.goto('/admin')
        const band = page.locator('#school-home #brand-band')
        await expect(band.getByRole('img', { name: alt })).toBeVisible({ timeout: 20_000 })
        expect(await loaded(page, '#brand-band img')).toBe(true)
        await expect(band.locator('img')).toHaveCSS('max-height', '96px')
        await expect(band).toHaveCSS('border-bottom-color', 'rgb(20, 83, 45)')
        await expect(band).toHaveCSS('box-shadow', /rgb\(255, 204, 0\)/)
        // Only the underline is the school's: the name stays in the district's primary.
        await expect(band.locator('span')).toHaveCSS('color', PRIMARY)
        expect(await blockingViolations(page)).toEqual([])
      } finally {
        for (const undo of restore.reverse()) await undo()
        await admin.delete(`/api/resources/${logo}`)
        await admin.dispose()
      }
    },
  )
})
