import { expect, type Page } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { dropPage, makePage, openPage, type FixturePage as Fixture } from './support/fixture-pages'
import { schoolTest } from './support/school-session'

/**
 * A new section's errors wait for Publish or Send for approval (Jason, 2026-11-19: "when a section
 * is added to a page it immediately shows an error — this should only happen if attempting to
 * publish or send for approval"). Seen on Text, Cards and others.
 *
 * Adding an empty section and letting it autosave shows nothing wrong; pressing Publish (the
 * district) or Send for approval (a school) shows what is missing, and neither goes through. The
 * rule is `src/lib/defer-section-validation.ts`, unit-tested in
 * `tests/unit/defer-section-validation.test.ts`; this drives the real form.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

/** Any of Payload's ways of marking a field wrong: the tooltip, the pill, the field's own message. */
const errors = (page: Page) =>
  page.locator('.tooltip--error, .error-pill, .field-error, .array-field__header-error')

const sectionsSaved = (fixture: Fixture, count: number) =>
  expect
    .poll(
      async () =>
        (
          (await (
            await fixture.admin.get(`/api/pages/${fixture.id}?draft=true&depth=0`)
          ).json()) as { layout?: unknown[] }
        ).layout?.length,
      { timeout: 20_000 },
    )
    .toBe(count)

const addSection = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Add Section' }).click()
  await page.getByRole('button', { name, exact: true }).first().click()
}

adminTest.describe('the district adds a section', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest(
    'an empty Cards section autosaves without an error; Publish shows it, and is refused',
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL)
      try {
        await openPage(page, fixture.id)
        await addSection(page, 'Cards')
        await sectionsSaved(fixture, 2)
        await expect(page.getByText('Last saved')).toBeVisible()
        await expect(errors(page)).toHaveCount(0)
        await expect(page.getByText(/This field requires/)).toHaveCount(0)

        await page.locator('#action-publish').click()
        await page
          .getByRole('dialog', { name: 'Publish this page' })
          .getByRole('button', { name: 'Publish now' })
          .click()
        await expect(page.getByText(/This field requires at least 1 Card/).first()).toBeVisible({
          timeout: 20_000,
        })
        const live = (await (
          await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)
        ).json()) as { _status?: string }
        expect(live._status).toBe('draft')
      } finally {
        await dropPage(fixture)
      }
    },
  )
})

schoolTest.describe('a school adds a section', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest(
    'an empty Text section autosaves without an error; Send for approval shows it, and is refused',
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL)
      try {
        await openPage(page, fixture.id)
        await addSection(page, 'Text')
        await sectionsSaved(fixture, 2)
        await expect(errors(page)).toHaveCount(0)

        await page
          .locator('.doc-controls')
          .getByRole('button', { name: 'Send for approval' })
          .click()
        await expect(errors(page).first()).toBeVisible({ timeout: 20_000 })
        const draft = (await (
          await fixture.admin.get(`/api/pages/${fixture.id}?draft=true&depth=0`)
        ).json()) as { reviewState?: string | null }
        expect(draft.reviewState).not.toBe('submitted')
      } finally {
        await dropPage(fixture)
      }
    },
  )
})
