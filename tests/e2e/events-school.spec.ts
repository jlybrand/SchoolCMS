import { expect, request as playwrightRequest } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { expectNoBlockingViolations, uniqueTitle } from './support/fixture-pages'
import { schoolTest } from './support/school-session'

/**
 * "Add an event" (Jason, 2026-11-11), end to end: the school's task, the event's form, and "Save
 * to the calendar" — events skip approval, so the school's event is live with no queue.
 *
 * The lock-in CLAUDE.md's exception table requires for custom admin React. The pure decisions are
 * `tests/unit/admin/school-plane.test.ts` (`checkNewEvent`); the access rule is
 * `tests/integration/tenant-isolation.test.ts` ("events skip approval").
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

const SAVE = { name: 'Save to the calendar' }

const asDistrict = (baseURL: string | undefined) =>
  playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })

const eventIdFrom = (url: string) => /\/collections\/events\/(\d+)/.exec(url)?.[1] ?? null

schoolTest.describe('add an event — school manager', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest(
    '@smoke from the task to the calendar: name, day, time, one button, no approval',
    async ({ page, baseURL }) => {
      await page.goto('/admin')
      await page.getByRole('link', { name: /Add an event/ }).click()
      await expect(page).toHaveURL(/\/admin\/new-event/, { timeout: 20_000 })
      const view = page.locator('#new-event')
      await expect(view.getByRole('heading', { name: 'Add an event' })).toBeVisible({
        timeout: 20_000,
      })

      // Nothing typed: told in words, every problem at once, focus on the first.
      const start = view.getByRole('button', { name: 'Add the details' })
      await expect(async () => {
        await start.click()
        await expect(view.getByText('Give the event a name.')).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      await expect(view.getByText('Choose the day it happens.')).toBeVisible()
      const name = view.getByLabel('What is the event called?')
      await expect(name).toBeFocused()
      // One calendar: never asked.
      await expect(view.getByText('Which calendar is it for?')).toHaveCount(0)

      const title = uniqueTitle('Book fair')
      await name.fill(title)
      await view.getByLabel('What day is it?').fill('2030-12-04')
      await view.getByLabel('What time does it start?').fill('18:30')
      await start.click()
      await page.waitForURL(/\/admin\/collections\/events\/\d+/, { timeout: 20_000 })
      const id = eventIdFrom(page.url())
      const district = await asDistrict(baseURL)

      try {
        await expect(page.locator('#field-title')).toHaveValue(title, { timeout: 20_000 })
        // 6:30 p.m. in the district, on its own school's calendar.
        const stored = (await (
          await district.get(`/api/events/${id}?draft=true&depth=0`)
        ).json()) as { start: string; allDay: boolean; calendar: number }
        expect(stored.start).toBe('2030-12-04T23:30:00.000Z')
        expect(stored.allDay).toBe(false)
        expect(stored.calendar).toBeTruthy()

        const controls = page.locator('.doc-controls')
        // One button, in the school's words; nothing says "publish" or "send for approval".
        await expect(controls.getByRole('button', SAVE)).toBeVisible()
        await expect(controls.getByRole('button', { name: /approval|publish/i })).toHaveCount(0)

        await page.locator('#field-location').fill('Library')
        await expect(async () => {
          const saved = page.waitForResponse(
            (res) =>
              res.url().includes(`/api/events/${id}`) &&
              !res.url().includes('autosave=true') &&
              res.request().method() === 'PATCH',
            { timeout: 5_000 },
          )
          await controls.getByRole('button', SAVE).click()
          expect((await saved).ok(), 'the save is accepted').toBe(true)
        }).toPass({ intervals: [500, 1_000], timeout: 30_000 })

        // On the calendar now: published, with what was typed.
        const live = (await (await district.get(`/api/events/${id}?depth=0`)).json()) as {
          _status: string
          location: string
        }
        expect(live).toMatchObject({ _status: 'published', location: 'Library' })
      } finally {
        if (id) await district.delete(`/api/events/${id}`)
        await district.dispose()
      }
    },
  )

  schoolTest('no start time makes it all day', async ({ page, baseURL }) => {
    await page.goto('/admin/new-event')
    const view = page.locator('#new-event')
    await view.getByLabel('What is the event called?').fill(uniqueTitle('Spirit day'))
    await view.getByLabel('What day is it?').fill('2030-07-15')
    await view.getByRole('button', { name: 'Add the details' }).click()
    await page.waitForURL(/\/admin\/collections\/events\/\d+/, { timeout: 20_000 })
    const id = eventIdFrom(page.url())
    const district = await asDistrict(baseURL)
    try {
      const stored = (await (
        await district.get(`/api/events/${id}?draft=true&depth=0`)
      ).json()) as { start: string; allDay: boolean }
      expect(stored).toMatchObject({ start: '2030-07-15T04:00:00.000Z', allDay: true })
    } finally {
      if (id) await district.delete(`/api/events/${id}`)
      await district.dispose()
    }
  })

  schoolTest('the events list leads to the task', async ({ page }) => {
    await page.goto('/admin/collections/events')
    await expect(page.locator('#list-task')).toHaveText('Add an event', { timeout: 20_000 })
    await expect(page.locator('#list-task')).toHaveAttribute('href', '/admin/new-event')
  })

  schoolTest(`@a11y the new-event screen, errors showing`, async ({ page }) => {
    await page.goto('/admin/new-event')
    const view = page.locator('#new-event')
    await expect(async () => {
      await view.getByRole('button', { name: 'Add the details' }).click()
      await expect(view.getByText('Give the event a name.')).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 20_000 })
    await expectNoBlockingViolations(page, '#new-event')
  })
})

schoolTest.describe('remove an event — school manager', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('takes their own event off the calendar, no one asked', async ({ page, baseURL }) => {
    await page.goto('/admin/new-event')
    const view = page.locator('#new-event')
    await view.getByLabel('What is the event called?').fill(uniqueTitle('Cancelled game'))
    await view.getByLabel('What day is it?').fill('2030-12-04')
    await view.getByRole('button', { name: 'Add the details' }).click()
    await page.waitForURL(/\/admin\/collections\/events\/\d+/, { timeout: 20_000 })
    const id = eventIdFrom(page.url())
    const district = await asDistrict(baseURL)
    try {
      await expect(page.locator('#field-title')).toBeEditable({ timeout: 20_000 })
      await page.locator('.doc-controls .popup-button').click()
      await page.getByRole('button', { name: 'Delete' }).click()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /confirm|delete/i })
        .click()
      await page.waitForURL(/\/admin\/collections\/events(\?|$)/, { timeout: 20_000 })
      const gone = await district.get(`/api/events/${id}?depth=0`)
      expect(gone.status()).toBe(404)
    } finally {
      await district.delete(`/api/events/${id}`)
      await district.dispose()
    }
  })
})
