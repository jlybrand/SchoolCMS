import { expect } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { schoolRequest, uniqueTitle } from './support/fixture-pages'
import { dropPost, makePost } from './support/fixture-posts'
import { SCHOOL_HOSTNAME } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * The Phase 5 exit check (`05`), the parts no other spec walks end to end:
 *
 * 1. An EMERGENCY ALERT posted from its template reaches a school's site — timed against `04`
 *    §9.7, "under 60 seconds" (English only until Phase 7). Logged as `alert-to-live`.
 * 2. A SCHOOL'S ANNOUNCEMENT goes through the approval queue — one click from the inline diff —
 *    and is on its site within seconds. Logged as `approve-to-live`.
 *
 * Everything else in the exit criterion is proven where it is built; the close-out maps each
 * clause to its proof (`docs/phases/05` §41).
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

adminTest.describe('Phase 5 exit', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest(
    'an emergency alert from its template is on a school’s site in under 60 seconds',
    async ({ page, baseURL }, testInfo) => {
      const reason = uniqueTitle('ice')
      let id: number | null = null
      try {
        await page.goto('/admin/collections/alerts/create')
        await expect(page.getByLabel('Use a template')).toBeChecked({ timeout: 20_000 })
        await page.getByText('School closure (emergency)', { exact: true }).click()
        await page.getByLabel('Day').fill('Wednesday')
        await page.getByLabel('Reason').fill(reason)

        const saved = Date.now()
        await page.locator('#action-save').click()
        await expect(page).toHaveURL(/\/admin\/collections\/alerts\/\d+$/, { timeout: 20_000 })
        id = Number(/\/alerts\/(\d+)$/.exec(page.url())?.[1])

        const school = siteUrl(baseURL, SCHOOL_HOSTNAME, '/')
        await expect(async () => {
          await page.goto(school)
          await expect(page.getByRole('region', { name: 'Alerts' })).toContainText(
            `Emergency: Schools are closed on Wednesday because of ${reason}.`,
            { timeout: 1_000 },
          )
        }).toPass({ timeout: 60_000 })
        const ms = Date.now() - saved
        testInfo.annotations.push({ type: 'alert-to-live', description: `${ms} ms` })
        expect(ms).toBeLessThan(60_000)
      } finally {
        if (id !== null) await page.request.delete(`/api/alerts/${id}`)
      }
    },
  )

  adminTest(
    'a school’s announcement is approved from the queue and is on its site in seconds',
    async ({ page, baseURL }, testInfo) => {
      const title = uniqueTitle('Book fair')
      const post = await makePost(baseURL, { title })
      const school = await schoolRequest(baseURL)
      try {
        // The school sends it; it is not on the site.
        const sent = await school.patch(`/api/posts/${post.id}?draft=true&depth=0`, {
          data: { reviewState: 'submitted' },
        })
        expect(sent.ok(), await sent.text()).toBe(true)
        const news = siteUrl(baseURL, SCHOOL_HOSTNAME, '/news')
        await page.goto(news)
        await expect(page.getByRole('link', { name: title })).toHaveCount(0)

        // The district: the queue, the inline diff, one click.
        await page.goto(`/admin/approvals#approval-posts-${post.id}`)
        const item = page.locator(`#approval-posts-${post.id}`)
        await expect(item.getByText(title).first()).toBeVisible({ timeout: 20_000 })
        const approved = Date.now()
        await item.getByRole('button', { name: 'Approve and publish' }).click()
        await expect(item.getByRole('status')).toContainText('Published.', { timeout: 20_000 })

        await expect(async () => {
          await page.goto(news)
          await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 1_000 })
        }).toPass({ timeout: 15_000 })
        testInfo.annotations.push({
          type: 'approve-to-live',
          description: `${Date.now() - approved} ms`,
        })
      } finally {
        await school.dispose()
        await dropPost(post)
      }
    },
  )
})
