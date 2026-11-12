import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { dropPage, makePage, schoolRequest, uniqueTitle } from './support/fixture-pages'

/**
 * The district dashboard (`04` §3.1; layout decided by Jason, 2026-11-04): approvals, what needs
 * freshening, recent activity, the auto-approval panel, then Payload's cards under "Everything
 * else". The lock-in CLAUDE.md's exception table requires for custom admin React; the decisions
 * are `tests/unit/lib/dashboard.test.ts`, the reads `tests/integration/dashboard.test.ts`. Axe
 * over the whole screen is `admin-planes-axe.spec.ts`.
 */

const credentials = adminCredentials()
const BLOCKING = ['critical', 'serious']

const blockingViolations = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations
    .filter((v) => BLOCKING.includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

adminTest.describe('the district dashboard', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest('@smoke the panels, in order, then everything else', async ({ page }) => {
    await page.goto('/admin')
    const dashboard = page.locator('#district-dashboard')
    await expect(dashboard.getByRole('heading', { level: 1 })).toHaveText('District dashboard', {
      timeout: 20_000,
    })
    // "Needs attention" leads only when something does — another spec's feed calendar may.
    const headings = (
      await page
        .locator('#district-dashboard h2, #grants-heading, #everything-else')
        .allTextContents()
    ).filter((h, i) => !(i === 0 && h === 'Needs attention'))
    expect(headings).toEqual([
      'Approvals',
      'Needs freshening',
      'Recent activity',
      'Auto-approval grants',
      'Everything else',
    ])
    // The way into the queue is there whether or not anything waits.
    await expect(
      page.locator('#approvals-panel').getByRole('link', { name: 'Open the approval queue' }),
    ).toBeVisible()
    // Payload's cards are kept, below (Jason, 2026-11-04).
    await expect(page.getByRole('link', { name: /Pages/ }).first()).toBeVisible()
  })

  adminTest(
    'a page sent for approval is counted, and appears in the activity with a link',
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL, { title: uniqueTitle('Dashboard check') })
      const school = await schoolRequest(baseURL)
      try {
        const sent = await school.patch(`/api/pages/${fixture.id}?draft=true`, {
          data: { reviewState: 'submitted' },
        })
        expect(sent.ok(), await sent.text()).toBe(true)

        await page.goto('/admin')
        const approvals = page.locator('#approvals-panel')
        await expect(approvals).toContainText(/waiting/, { timeout: 20_000 })
        await expect(approvals.getByRole('link', { name: 'Open the approval queue' })).toBeVisible()

        const activity = page.locator('#activity-panel')
        const line = activity.getByRole('link', {
          name: new RegExp(`sent the page “${fixture.title}” for approval`),
        })
        await expect(line).toHaveAttribute('href', `/admin/collections/pages/${fixture.id}`)
        // Content only: sign-ins never appear (Jason, 2026-11-04) — the admin signed in to get here.
        await expect(activity).not.toContainText(/signed in|logged in/i)
      } finally {
        await school.dispose()
        await dropPage(fixture)
      }
    },
  )

  adminTest('needs freshening names what is stale, or says nothing is', async ({ page }) => {
    await page.goto('/admin')
    const panel = page.locator('#freshness-panel')
    await expect(panel.getByRole('heading', { name: 'Needs freshening' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(panel).toContainText(
      /Every site and key page has changed|Sites with no change in 90 days|Key pages unchanged in 90 days/,
    )
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(
      `@a11y a calendar feed that failed is a banner, linking to the calendar — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const fixture = await makePage(baseURL, { title: uniqueTitle('Feed banner') })
        let calendar: number | null = null
        try {
          const tenant = (
            (await (await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)).json()) as {
              tenant: number
            }
          ).tenant
          // `.invalid` never resolves, so the copy fails and the problem is recorded in words.
          const name = uniqueTitle('Broken feed')
          const made = await fixture.admin.post('/api/calendars?depth=0', {
            data: { tenant, name, source: 'feed', feedUrl: 'https://example.invalid/feed.ics' },
          })
          expect(made.ok(), await made.text()).toBe(true)
          calendar = ((await made.json()).doc as { id: number }).id
          // The job runner's own endpoint (district-only) instead of waiting for its cron.
          await expect
            .poll(
              async () => {
                await fixture.admin.get('/api/payload-jobs/run?queue=default&limit=50')
                const doc = (await (
                  await fixture.admin.get(`/api/calendars/${calendar}?depth=0`)
                ).json()) as { feedError?: string | null }
                return doc.feedError ?? ''
              },
              { timeout: 30_000 },
            )
            .not.toBe('')

          await page.goto('/admin')
          const attention = page.locator('#attention-panel')
          await expect(attention.getByRole('heading', { name: 'Needs attention' })).toBeVisible({
            timeout: 20_000,
          })
          const banner = attention.getByRole('link', {
            name: new RegExp(`${name}: the calendar feed could not be copied`),
          })
          await expect(banner).toHaveAttribute('href', `/admin/collections/calendars/${calendar}`)
          expect(await blockingViolations(page)).toEqual([])
        } finally {
          if (calendar !== null) await fixture.admin.delete(`/api/calendars/${calendar}`)
          await dropPage(fixture)
        }
      },
    )
  }
})
