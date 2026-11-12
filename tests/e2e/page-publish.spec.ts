import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { dropPage, makePage, openPage, uniqueTitle } from './support/fixture-pages'
import { openPageSettings } from './support/page-settings'
import { schoolTest } from './support/school-session'

/**
 * A page's Start, chosen when publishing (Jason, 2026-11-11): "Publish now" or "Schedule…" in the
 * header, in place of a Start field. Built, then locked here (CLAUDE.md: admin views are not
 * test-first); the rules underneath are `tests/unit/admin/page-publish.test.ts`,
 * `tests/unit/access/review-state.test.ts` (cancel) and `tests/integration/schedule.test.ts`.
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

/** A day and time as a `datetime-local` input takes it, `days` from now at 09:30 local. */
const daysAhead = (days: number) => {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:30`
}

type Draft = { _status: string; reviewState: string | null; publishAt: string | null }

adminTest.describe('publishing a page', () => {
  adminTest.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(
      `@a11y schedule, then cancel — from the header — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const fixture = await makePage(baseURL, { title: uniqueTitle('Schedule me') })
        const draft = async () =>
          (await (
            await fixture.admin.get(`/api/pages/${fixture.id}?draft=true&depth=0`)
          ).json()) as Draft
        try {
          await openPage(page, fixture.id)
          const scheduleButton = page.locator('#action-schedule')
          await expect(scheduleButton).toHaveText('Schedule…')
          await expect(page.getByRole('button', { name: 'Publish now' })).toBeVisible()
          // No Start field anywhere: not beside Publish, not in Page settings.
          await expect(page.locator('#field-publishAt')).toBeHidden()

          // The dialog: named, a labelled day-and-time, a refusal for a time gone by.
          await scheduleButton.click()
          const dialog = page.getByRole('dialog', { name: 'Schedule this page' })
          await expect(dialog).toBeVisible()
          const at = dialog.getByLabel('Goes live on')
          await at.fill(daysAhead(-1))
          await dialog.getByRole('button', { name: 'Schedule', exact: true }).click()
          await expect(dialog.getByRole('alert')).toHaveText('Choose a time in the future.')
          await expect(at).toHaveAttribute('aria-invalid', 'true')
          await expect(at).toBeFocused()
          expect(await blockingViolations(page)).toEqual([])

          await at.fill(daysAhead(3))
          await dialog.getByRole('button', { name: 'Schedule', exact: true }).click()
          await expect(dialog).toBeHidden()
          await expect(scheduleButton).toHaveText(/^Scheduled for /, { timeout: 20_000 })
          await expect.poll(async () => (await draft()).reviewState).toBe('scheduled')
          const stored = await draft()
          expect(stored._status).toBe('draft')
          expect(new Date(stored.publishAt as string).getTime()).toBe(
            new Date(daysAhead(3)).getTime(),
          )

          // Opened again: the time it has, change it or cancel it.
          await scheduleButton.click()
          const change = page.getByRole('dialog', { name: 'Change when this page goes live' })
          await expect(change.getByLabel('Goes live on')).toHaveValue(daysAhead(3))
          expect(await blockingViolations(page)).toEqual([])
          await change.getByRole('button', { name: 'Cancel the schedule' }).click()
          await expect(scheduleButton).toHaveText('Schedule…', { timeout: 20_000 })
          await expect.poll(async () => (await draft()).reviewState).toBeNull()
          expect((await draft()).publishAt).toBeNull()
        } finally {
          await dropPage(fixture)
        }
      },
    )
  }

  adminTest('Escape closes the schedule dialog and gives focus back', async ({ page, baseURL }) => {
    const fixture = await makePage(baseURL, { title: uniqueTitle('Escape') })
    try {
      await openPage(page, fixture.id)
      const scheduleButton = page.locator('#action-schedule')
      await scheduleButton.click()
      const dialog = page.getByRole('dialog', { name: 'Schedule this page' })
      await expect(dialog.getByLabel('Goes live on')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(scheduleButton).toBeFocused()
    } finally {
      await dropPage(fixture)
    }
  })

  adminTest('“Publish now” on a scheduled page puts it live at once', async ({ page, baseURL }) => {
    const fixture = await makePage(baseURL, { title: uniqueTitle('Now instead') })
    try {
      // Scheduled through the API, as the header's Schedule sends it.
      const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
      const res = await fixture.admin.patch(`/api/pages/${fixture.id}?depth=0`, {
        data: { _status: 'published', publishAt: start },
      })
      expect(res.ok(), await res.text()).toBe(true)

      await openPage(page, fixture.id)
      await expect(page.locator('#action-schedule')).toHaveText(/^Scheduled for /)
      await page.getByRole('button', { name: 'Publish now' }).click()
      // Live: the header now offers Payload's "Publish changes", and nothing to schedule.
      await expect(page.locator('#action-schedule')).toHaveCount(0, { timeout: 20_000 })
      const live = (await (
        await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)
      ).json()) as Draft
      expect(live).toMatchObject({ _status: 'published', publishAt: null, reviewState: null })
    } finally {
      await dropPage(fixture)
    }
  })

  adminTest(
    'a page already on the site has Payload’s Publish, and no Start in Page settings',
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL, { title: uniqueTitle('Already live') })
      try {
        await fixture.admin.patch(`/api/pages/${fixture.id}?depth=0`, {
          data: { _status: 'published' },
        })
        await openPage(page, fixture.id)
        await expect(page.locator('#action-save')).toBeVisible()
        await expect(page.locator('#action-schedule')).toHaveCount(0)
        const dialog = await openPageSettings(page)
        await expect(dialog.getByText('Start', { exact: true })).toHaveCount(0)
      } finally {
        await dropPage(fixture)
      }
    },
  )
})

schoolTest.describe('a school manager publishing a page', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('still sends it for approval, with nothing to schedule', async ({ page, baseURL }) => {
    const fixture = await makePage(baseURL, { title: uniqueTitle('School send') })
    try {
      await page.goto(`/admin/collections/pages/${fixture.id}`)
      await expect(page.locator('#action-send-for-approval')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#action-schedule')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Publish now' })).toHaveCount(0)
    } finally {
      await dropPage(fixture)
    }
  })
})
