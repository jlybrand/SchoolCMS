import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { dropPage, makePage, uniqueTitle } from './support/fixture-pages'
import { dropPost, makePost } from './support/fixture-posts'
import { SCHOOL_HOSTNAME, schoolTest, tenantIdFor } from './support/school-session'

/**
 * Which site a document is on, atop its form (Jason, 2026-11-18): the district works across every
 * site, and the left menu's tenant select was the only place it said. A school manager has one
 * school, named in their menu, so it is not repeated for them. Built, then locked here (CLAUDE.md:
 * admin views are not test-first).
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'
const BLOCKING = ['critical', 'serious']

const blockingViolations = async (page: Page) =>
  (
    await new AxeBuilder({ page })
      .include('#doc-site')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
  ).violations
    .filter((v) => BLOCKING.includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)

adminTest.describe('the district sees which site a document is on', () => {
  adminTest.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(`@a11y on a page’s form — ${colorScheme}`, async ({ page, baseURL }) => {
      await page.emulateMedia({ colorScheme })
      const fixture = await makePage(baseURL, { title: uniqueTitle('Families') })
      try {
        await page.goto(`/admin/collections/pages/${fixture.id}`)
        const site = page.locator('#doc-site')
        await expect(site).toHaveText(/Site\s*School A/, { timeout: 20_000 })
        // Atop the form, before the page's own fields.
        const before = await page.evaluate(() => {
          const badge = document.getElementById('doc-site')
          const title = document.querySelector('[name="title"]')
          return Boolean(badge && title && badge.compareDocumentPosition(title) & 4)
        })
        expect(before).toBe(true)
        expect(await blockingViolations(page)).toEqual([])
        const sizes = await site
          .locator('span, strong')
          .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)))
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(15)
      } finally {
        await dropPage(fixture)
      }
    })
  }

  adminTest('on an announcement’s form', async ({ page, baseURL }) => {
    const post = await makePost(baseURL, { title: uniqueTitle('Picture day') })
    try {
      await page.goto(`/admin/collections/posts/${post.id}`)
      await expect(page.locator('#doc-site')).toHaveText(/Site\s*School A/, { timeout: 20_000 })
    } finally {
      await dropPost(post)
    }
  })
})

adminTest.describe('…and on an event’s form', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest('an event shows its site too', async ({ page }) => {
    const tenant = await tenantIdFor(page.request, SCHOOL_HOSTNAME)
    const made = await page.request.post('/api/events?depth=0', {
      data: {
        tenant,
        title: uniqueTitle('Book fair'),
        start: '2027-03-20T15:00:00.000Z',
        _status: 'draft',
      },
    })
    expect(made.ok(), await made.text()).toBe(true)
    const id = ((await made.json()) as { doc: { id: number } }).doc.id
    try {
      await page.goto(`/admin/collections/events/${id}`)
      await expect(page.locator('[name="title"]')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#doc-site')).toHaveText(/Site\s*School A/)
    } finally {
      await page.request.delete(`/api/events/${id}`)
    }
  })
})

/** School A's main calendar — named after the site, made with it. */
const mainCalendar = async (request: Page['request']) => {
  const tenant = await tenantIdFor(request, SCHOOL_HOSTNAME)
  const res = await request.get(
    `/api/calendars?where[and][0][tenant][equals]=${tenant}&where[and][1][isMain][equals]=true&limit=1&depth=0`,
  )
  return ((await res.json()) as { docs: { id: number }[] }).docs[0]!.id
}

adminTest.describe('…and above a calendar’s list of events', () => {
  adminTest.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(`@a11y the site and the calendar — ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      const calendar = await mainCalendar(page.request)
      // The address the Events panel writes (`calendarEventsHref`).
      await page.goto(`/admin/collections/events?where%5Bcalendar%5D%5Bequals%5D=${calendar}`)
      const heading = page.locator('#list-site')
      await expect(heading).toHaveText(/Site\s*School A\s*Calendar\s*School A/, {
        timeout: 20_000,
      })
      const results = await new AxeBuilder({ page })
        .include('#list-site')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      expect(results.violations.filter((v) => BLOCKING.includes(v.impact ?? ''))).toEqual([])
    })
  }

  adminTest('the whole list, every calendar: nothing to name', async ({ page }) => {
    await page.goto('/admin/collections/events')
    await expect(page.locator('.collection-list')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('#list-site')).toHaveCount(0)
  })
})

schoolTest.describe('a school manager', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest(
    'is not told the site again — their one school is named in the menu',
    async ({ page }) => {
      await page.goto('/admin/collections/pages')
      await page.locator('tbody tr a').first().click()
      await expect(page.locator('[name="title"]')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#doc-site')).toHaveCount(0)
    },
  )

  schoolTest('above their calendar’s list: the calendar, not the site', async ({ page }) => {
    const calendar = await mainCalendar(page.request)
    await page.goto(`/admin/collections/events?where%5Bcalendar%5D%5Bequals%5D=${calendar}`)
    const heading = page.locator('#list-site')
    await expect(heading).toHaveText(/Calendar\s*School A/, { timeout: 20_000 })
    await expect(heading).not.toContainText('Site')
  })
})
