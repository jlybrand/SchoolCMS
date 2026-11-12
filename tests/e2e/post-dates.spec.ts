import { expect, request as playwrightRequest } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import {
  dropPage,
  expectNoBlockingViolations,
  makePage,
  schoolRequest,
  uniqueTitle,
} from './support/fixture-pages'
import { dropPost, makePost, type FixturePost } from './support/fixture-posts'
import { schoolTest } from './support/school-session'

/**
 * An announcement's dates in the admin (Jason, 2026-11-04): set in the queue as it is approved —
 * "Approve and schedule" with a future Start — and on the district's post form, never the
 * school's. The rules are `tests/unit/lib/post-dates.test.ts`; going live and expiring over the
 * real stack are `tests/integration/post-schedule.test.ts`.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

/** A `datetime-local` value `hours` from now, on this machine's clock — the browser's too. */
const localInput = (hours: number): string => {
  const d = new Date(Date.now() + hours * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A post on School A's board, sent for approval by School A. */
const sentPost = async (baseURL: string | undefined, title: string): Promise<FixturePost> => {
  const post = await makePost(baseURL, { title })
  const school = await schoolRequest(baseURL)
  const sent = await school.patch(`/api/posts/${post.id}?draft=true`, {
    data: { reviewState: 'submitted' },
  })
  expect(sent.ok(), await sent.text()).toBe(true)
  await school.dispose()
  return post
}

adminTest.describe('dates in the approval queue', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest(
    '@smoke a future Start makes it “Approve and schedule”, and it leaves the queue scheduled',
    async ({ page, baseURL }) => {
      const title = uniqueTitle('Picture day')
      const post = await sentPost(baseURL, title)
      try {
        await page.goto('/admin/approvals')
        const item = page.getByRole('article', { name: new RegExp(title) })
        await expect(item).toBeVisible({ timeout: 20_000 })
        // Closed by default: one click still publishes.
        await expect(item.getByRole('button', { name: 'Approve and publish' })).toBeVisible()

        await item.getByText('Set dates').click()
        await item.getByLabel('Start').fill(localInput(48))
        const schedule = item.getByRole('button', { name: 'Approve and schedule' })
        await expect(schedule).toBeVisible()
        await schedule.click()
        await expect(item.getByRole('status')).toContainText(`Approved. “${title}” goes live on`, {
          timeout: 15_000,
        })

        const stored = await post.admin.get(`/api/posts/${post.id}?draft=true&depth=0`)
        const doc = (await stored.json()) as { reviewState: string; publishAt: string }
        expect(doc.reviewState).toBe('scheduled')
        expect(doc.publishAt).toBeTruthy()
        const live = await post.admin.get(`/api/posts/${post.id}?depth=0`)
        expect(((await live.json()) as { _status: string })._status).not.toBe('published')
      } finally {
        await dropPost(post)
      }
    },
  )

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(
      `@a11y a wrong date is said beside it, and nothing is sent — ${colorScheme}`,
      async ({ page, baseURL }) => {
        const title = uniqueTitle('Book fair')
        const post = await sentPost(baseURL, title)
        try {
          await page.emulateMedia({ colorScheme })
          await page.goto('/admin/approvals')
          const item = page.getByRole('article', { name: new RegExp(title) })
          await expect(item).toBeVisible({ timeout: 20_000 })
          await item.getByText('Set dates').click()
          await item.getByLabel('Start').fill(localInput(48))
          await item.getByLabel('Expires').fill(localInput(24))
          await item.getByRole('button', { name: 'Approve and schedule' }).click()

          await expect(item.getByLabel('Expires')).toHaveAttribute('aria-invalid', 'true')
          await expect(item).toContainText('Choose an expiration after the announcement goes live.')
          await expectNoBlockingViolations(page, `[id="${await item.getAttribute('id')}"]`)

          const stored = await post.admin.get(`/api/posts/${post.id}?draft=true&depth=0`)
          expect(((await stored.json()) as { reviewState: string }).reviewState).toBe('submitted')
        } finally {
          await dropPost(post)
        }
      },
    )
  }

  adminTest('the district’s post form has the dates', async ({ page, baseURL }) => {
    const post = await makePost(baseURL, { title: uniqueTitle('Form dates') })
    try {
      await page.goto(`/admin/collections/posts/${post.id}`)
      for (const label of ['Expires', 'Featured until']) {
        await expect(page.getByText(label, { exact: true }).first()).toBeVisible({
          timeout: 20_000,
        })
      }
      // Start is chosen in the Publish dialog, as a page's is (Jason, 2026-11-12).
      await expect(page.locator('#field-publishAt')).toBeHidden()
      await expect(page.locator('#action-publish')).toHaveText('Publish')
    } finally {
      await dropPost(post)
    }
  })
})

schoolTest.describe('dates are the district’s', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('a school’s post form shows none of them', async ({ page, baseURL }) => {
    const post = await makePost(baseURL, { title: uniqueTitle('School view') })
    try {
      await page.goto(`/admin/collections/posts/${post.id}`)
      await expect(page.locator('#field-title')).toBeVisible({ timeout: 20_000 })
      for (const field of ['publishAt', 'expiresAt', 'featuredUntil']) {
        await expect(page.locator(`#field-${field}`)).toHaveCount(0)
      }
    } finally {
      await dropPost(post)
    }
  })

  schoolTest(
    'the schedule’s endpoint answers nobody but the district and the job',
    async ({ page, baseURL }) => {
      expect((await page.request.post('/api/schedule/run')).status()).toBe(403)
      const anonymous = await playwrightRequest.newContext(baseURL ? { baseURL } : {})
      expect((await anonymous.post('/api/schedule/run')).status()).toBe(403)
      expect(
        (
          await anonymous.post('/api/schedule/run', {
            headers: { 'x-dd2-schedule-key': 'guess' },
          })
        ).status(),
      ).toBe(403)
      await anonymous.dispose()
    },
  )
})

schoolTest.describe('a page’s Start is the district’s', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('a school’s page form has no Start', async ({ page, baseURL }) => {
    const fixture = await makePage(baseURL, { title: uniqueTitle('School page') })
    try {
      await page.goto(`/admin/collections/pages/${fixture.id}`)
      await expect(page.locator('#field-title')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#field-publishAt')).toHaveCount(0)
    } finally {
      await dropPage(fixture)
    }
  })
})
