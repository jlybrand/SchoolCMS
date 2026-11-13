import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { dropPage, makePage, openPage, uniqueTitle } from './support/fixture-pages'
import { openPageSettings } from './support/page-settings'
import { expectScheduleTime, scheduleTime, setScheduleTime } from './support/schedule-time'
import { schoolTest } from './support/school-session'

/**
 * A page's Start, chosen when publishing: ONE Publish button whose dialog asks "now or later"
 * (Jason, 2026-11-12; the Start left Page settings 2026-11-11). Built, then locked here (CLAUDE.md:
 * admin views are not test-first); the rules underneath are `tests/unit/admin/page-publish.test.ts`,
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
      `@a11y schedule, then cancel — from the one Publish button — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const fixture = await makePage(baseURL, { title: uniqueTitle('Schedule me') })
        const draft = async () =>
          (await (
            await fixture.admin.get(`/api/pages/${fixture.id}?draft=true&depth=0`)
          ).json()) as Draft
        try {
          await openPage(page, fixture.id)
          const publish = page.locator('#action-publish')
          await expect(publish).toHaveText('Publish')
          // One button: no second publish action beside it, and no Start field anywhere.
          await expect(page.getByRole('button', { name: 'Publish now' })).toHaveCount(0)
          await expect(page.locator('#field-publishAt')).toBeHidden()

          // The dialog opens on "Now", with focus on it.
          await publish.click()
          const dialog = page.getByRole('dialog', { name: 'Publish this page' })
          await expect(dialog).toBeVisible()
          await expect(dialog.getByLabel('Now')).toBeChecked()
          await expect(dialog.getByLabel('Now')).toBeFocused()
          await expect(scheduleTime(dialog, 'Goes live on')).toHaveCount(0)
          await expect(dialog.getByRole('button', { name: 'Publish now' })).toBeVisible()
          expect(await blockingViolations(page)).toEqual([])

          // "At a set time": a labelled day-and-time, and a refusal for a time gone by.
          await dialog.getByLabel('At a set time').check()
          // A day and a Time list in five-minute steps — nothing between them is offered.
          const at = scheduleTime(dialog, 'Goes live on')
          await expect(at.getByLabel('Time').locator('option[value="09:05"]')).toHaveCount(1)
          await expect(at.getByLabel('Time').locator('option[value="09:03"]')).toHaveCount(0)
          await setScheduleTime(at, daysAhead(-1))
          await dialog.getByRole('button', { name: 'Schedule', exact: true }).click()
          await expect(dialog.getByRole('alert')).toHaveText('Choose a time in the future.')
          await expect(at.getByLabel('Day')).toHaveAttribute('aria-invalid', 'true')
          await expect(at.getByLabel('Day')).toBeFocused()
          expect(await blockingViolations(page)).toEqual([])

          await setScheduleTime(at, daysAhead(3))
          await dialog.getByRole('button', { name: 'Schedule', exact: true }).click()
          await expect(dialog).toBeHidden()
          await expect(publish).toHaveText(/^Scheduled for /, { timeout: 20_000 })
          await expect.poll(async () => (await draft()).reviewState).toBe('scheduled')
          const stored = await draft()
          expect(stored._status).toBe('draft')
          expect(new Date(stored.publishAt as string).getTime()).toBe(
            new Date(daysAhead(3)).getTime(),
          )

          // Opened again: on "At a set time", with its time — change it, or cancel it.
          await publish.click()
          const change = page.getByRole('dialog', { name: 'Change when this page goes live' })
          await expect(change.getByLabel('At a set time')).toBeChecked()
          await expectScheduleTime(scheduleTime(change, 'Goes live on'), daysAhead(3))
          await expect(change.getByRole('button', { name: 'Save the new time' })).toBeVisible()
          expect(await blockingViolations(page)).toEqual([])
          await change.getByRole('button', { name: 'Cancel the schedule' }).click()
          await expect(publish).toHaveText('Publish', { timeout: 20_000 })
          await expect.poll(async () => (await draft()).reviewState).toBeNull()
          expect((await draft()).publishAt).toBeNull()
        } finally {
          await dropPage(fixture)
        }
      },
    )
  }

  adminTest('“Publish now” in the dialog puts a new page live', async ({ page, baseURL }) => {
    const fixture = await makePage(baseURL, { title: uniqueTitle('Straight up') })
    try {
      await openPage(page, fixture.id)
      await page.locator('#action-publish').click()
      const dialog = page.getByRole('dialog', { name: 'Publish this page' })
      await dialog.getByRole('button', { name: 'Publish now' }).click()
      // Live: the same button now publishes changes — and there are none yet.
      const publish = page.locator('#action-publish')
      await expect(publish).toHaveText('Publish changes', { timeout: 20_000 })
      await expect(publish).toBeDisabled()
      const live = (await (
        await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)
      ).json()) as Draft
      expect(live).toMatchObject({ _status: 'published', publishAt: null })
    } finally {
      await dropPage(fixture)
    }
  })

  adminTest('Escape closes the dialog and gives focus back', async ({ page, baseURL }) => {
    const fixture = await makePage(baseURL, { title: uniqueTitle('Escape') })
    try {
      await openPage(page, fixture.id)
      const publish = page.locator('#action-publish')
      await publish.click()
      const dialog = page.getByRole('dialog', { name: 'Publish this page' })
      await expect(dialog.getByLabel('Now')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(publish).toBeFocused()
    } finally {
      await dropPage(fixture)
    }
  })

  adminTest('“Now” on a scheduled page puts it live at once', async ({ page, baseURL }) => {
    const fixture = await makePage(baseURL, { title: uniqueTitle('Now instead') })
    try {
      // Scheduled through the API, as the dialog's Schedule sends it.
      const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
      const res = await fixture.admin.patch(`/api/pages/${fixture.id}?depth=0`, {
        data: { _status: 'published', publishAt: start },
      })
      expect(res.ok(), await res.text()).toBe(true)

      await openPage(page, fixture.id)
      const publish = page.locator('#action-publish')
      await expect(publish).toHaveText(/^Scheduled for /)
      await publish.click()
      const dialog = page.getByRole('dialog', { name: 'Change when this page goes live' })
      await dialog.getByLabel('Now').check()
      await dialog.getByRole('button', { name: 'Publish now' }).click()
      await expect(publish).toHaveText('Publish changes', { timeout: 20_000 })
      const live = (await (
        await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)
      ).json()) as Draft
      expect(live).toMatchObject({ _status: 'published', publishAt: null, reviewState: null })
    } finally {
      await dropPage(fixture)
    }
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(
      `@a11y a change to a page on the site is scheduled, and the site keeps the page as it was — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const fixture = await makePage(baseURL, { title: uniqueTitle('Already live') })
        const onSite = async () =>
          (await (await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)).json()) as Draft & {
            title: string
          }
        try {
          await fixture.admin.patch(`/api/pages/${fixture.id}?depth=0`, {
            data: { _status: 'published' },
          })
          const before = (await onSite()).title
          await openPage(page, fixture.id)
          const publish = page.locator('#action-publish')
          // Nothing new to publish yet, and no Start in Page settings.
          await expect(publish).toHaveText('Publish changes')
          await expect(publish).toBeDisabled()
          const settings = await openPageSettings(page)
          await expect(settings.getByText('Start', { exact: true })).toHaveCount(0)

          // A change saved but not published — as autosave leaves one.
          const res = await fixture.admin.patch(`/api/pages/${fixture.id}?draft=true&depth=0`, {
            data: { title: `${before} (changed)` },
          })
          expect(res.ok(), await res.text()).toBe(true)
          await openPage(page, fixture.id)
          await expect(publish).toBeEnabled()

          await publish.click()
          const dialog = page.getByRole('dialog', { name: 'Publish your changes' })
          await expect(dialog.getByLabel('Now')).toBeChecked()
          await dialog.getByLabel('At a set time').check()
          await expect(
            dialog.getByText('The page on the site stays as it is until then.', { exact: false }),
          ).toBeVisible()
          await setScheduleTime(scheduleTime(dialog, 'Goes live on'), daysAhead(2))
          expect(await blockingViolations(page)).toEqual([])
          await dialog.getByRole('button', { name: 'Schedule', exact: true }).click()

          await expect(publish).toHaveText(/^Changes scheduled for /, { timeout: 20_000 })
          // The site still has the page, as it was.
          expect(await onSite()).toMatchObject({ _status: 'published', title: before })

          // Cancelled: still up, the change kept as a draft, nothing scheduled.
          await publish.click()
          const change = page.getByRole('dialog', { name: 'Change when your changes go live' })
          await expectScheduleTime(scheduleTime(change, 'Goes live on'), daysAhead(2))
          expect(await blockingViolations(page)).toEqual([])
          await change.getByRole('button', { name: 'Cancel the schedule' }).click()
          await expect(publish).toHaveText('Publish changes', { timeout: 20_000 })
          expect(await onSite()).toMatchObject({ _status: 'published', title: before })
        } finally {
          await dropPage(fixture)
        }
      },
    )
  }
})

schoolTest.describe('a school manager publishing a page', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('still sends it for approval, with nothing to schedule', async ({ page, baseURL }) => {
    const fixture = await makePage(baseURL, { title: uniqueTitle('School send') })
    try {
      await page.goto(`/admin/collections/pages/${fixture.id}`)
      await expect(page.locator('#action-send-for-approval')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#action-publish')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Publish now' })).toHaveCount(0)
    } finally {
      await dropPage(fixture)
    }
  })
})
