import AxeBuilder from '@axe-core/playwright'
import { expect, request as playwrightRequest, type Page } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, adminTest } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { schoolTest, SCHOOL_HOSTNAME, tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * Alert banners (Jason, 2026-11-12): the district posts them from a template (or its own words),
 * places them by site and page, and they show above the site's header — an emergency to stay, a
 * warning or notice a visitor may close. Built, then locked here (CLAUDE.md: admin views are not
 * test-first); the rules are `tests/unit/lib/alerts.test.ts` and `tests/integration/alerts.test.ts`.
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

const asDistrict = (baseURL: string | undefined) =>
  playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })

adminTest.describe('posting an alert', () => {
  adminTest.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(
      `@a11y a closure from its template, on home pages — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const reason = uniqueTitle('snow')
        const admin = await asDistrict(baseURL)
        let id: number | null = null
        try {
          await page.goto('/admin/collections/alerts/create')
          await expect(page.getByLabel('Use a template')).toBeChecked({ timeout: 20_000 })
          // Payload draws its own circle over each radio, so the option is chosen by its label.
          await page.getByText('School closure (emergency)', { exact: true }).click()
          await expect(page.getByLabel('School closure (emergency)')).toBeChecked()
          await page.getByLabel('Day').fill('Tuesday, January 14')
          await page.getByLabel('Reason').fill(reason)
          await page.getByText('Home pages only', { exact: true }).click()
          await expect(page.getByLabel('Home pages only')).toBeChecked()
          expect(await blockingViolations(page)).toEqual([])
          await page.locator('#action-save').click()
          await expect(page).toHaveURL(/\/admin\/collections\/alerts\/\d+$/, { timeout: 20_000 })
          id = Number(/\/alerts\/(\d+)$/.exec(page.url())?.[1])

          // On a school's home page, above the header, in words, with no way to close it.
          const visitor = page
          await visitor.goto(siteUrl(baseURL, SCHOOL_HOSTNAME, '/'))
          const alerts = visitor.getByRole('region', { name: 'Alerts' })
          await expect(alerts).toContainText(
            `Emergency: Schools are closed on Tuesday, January 14 because of ${reason}.`,
          )
          // This banner, not the region: other tests' alerts (a closable warning on every page of
          // the same school) can be showing alongside it.
          const closure = alerts.locator('[data-severity]').filter({ hasText: reason })
          await expect(closure).toHaveAttribute('data-severity', 'emergency')
          await expect(closure.getByRole('button')).toHaveCount(0)

          // Home pages only: not on another page.
          await visitor.goto(siteUrl(baseURL, SCHOOL_HOSTNAME, '/about'))
          await expect(visitor.getByText(reason, { exact: false })).toHaveCount(0)
        } finally {
          if (id !== null) await admin.delete(`/api/alerts/${id}`)
          await admin.dispose()
        }
      },
    )
  }

  adminTest(
    '@a11y a warning can be closed by a visitor, and stays closed on the next page',
    async ({ page, baseURL }) => {
      const admin = await asDistrict(baseURL)
      const tenant = await tenantIdFor(admin, SCHOOL_HOSTNAME)
      const delay = uniqueTitle('2 hours')
      const made = await admin.post('/api/alerts?depth=0', {
        data: {
          kind: 'template',
          template: 'delay',
          date: 'Friday',
          delay,
          siteScope: 'chosen',
          sites: [tenant],
          pageScope: 'every',
        },
      })
      expect(made.ok(), await made.text()).toBe(true)
      const id = ((await made.json()).doc as { id: number }).id
      try {
        await page.goto(siteUrl(baseURL, SCHOOL_HOSTNAME, '/about'))
        const alerts = page.getByRole('region', { name: 'Alerts' })
        await expect(alerts).toContainText(`Warning: Schools open ${delay} late on Friday.`)
        expect(await blockingViolations(page)).toEqual([])

        await alerts.getByRole('button', { name: 'Close: Warning' }).click()
        await expect(page.getByText(delay, { exact: false })).toHaveCount(0)
        await page.goto(siteUrl(baseURL, SCHOOL_HOSTNAME, '/'))
        await expect(page.locator('main')).toBeVisible()
        await expect(page.getByText(delay, { exact: false })).toHaveCount(0)
      } finally {
        await admin.delete(`/api/alerts/${id}`)
        await admin.dispose()
      }
    },
  )

  // The schedule refreshes the sites on the five (`src/lib/schedule-step.ts`, 2026-11-13), so the
  // Starts and Ends lists offer only those times — none between.
  adminTest('Starts and Ends list times in five-minute steps', async ({ page }) => {
    await page.goto('/admin/collections/alerts/create')
    await expect(page.getByLabel('Use a template')).toBeChecked({ timeout: 20_000 })
    for (const field of ['#field-startAt', '#field-endAt']) {
      await page.locator(`${field} input`).click()
      const times = page.locator('.react-datepicker__time-list-item')
      await expect(times).toHaveCount(288)
      await expect(times.getByText('12:05 AM', { exact: true })).toHaveCount(1)
      await expect(times.getByText('12:03 AM', { exact: true })).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(times).toHaveCount(0)
    }
  })
})

schoolTest.describe('a school manager', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('neither sees nor reaches alerts', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.locator('#school-home')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: 'Alerts', exact: true })).toHaveCount(0)
    const res = await page.request.get('/api/alerts')
    expect(res.status()).toBe(403)
  })
})
