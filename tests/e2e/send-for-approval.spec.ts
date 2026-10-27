import { expect } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import {
  dropPage,
  expectNoBlockingViolations,
  makePage,
  openPage,
  type FixturePage as Fixture,
} from './support/fixture-pages'
import { SCHOOL_HOSTNAME, schoolTest as test } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * The school plane's one button (`04` §2.3).
 *
 * The lock-in CLAUDE.md's TDD exception table requires for custom admin React: the flow a
 * school manager takes, driven through the real form, plus axe over what was added. The pure
 * halves — who gets the button, what the status says — are unit-tested in
 * `tests/unit/admin/send-for-approval.test.ts`; the state transitions are
 * `review-state.test.ts`'s. This asserts they are wired together.
 *
 * EACH TEST GETS ITS OWN PAGE, made by the district admin through the API and deleted after.
 * A seeded page would carry its review state from one run into the next.
 */

const credentials = adminCredentials()
const SEND = { name: 'Send for approval' }

const latestDraft = async ({ id, admin }: Fixture) => {
  const res = await admin.get(`/api/pages/${id}?draft=true&depth=0`)
  return (await res.json()) as { reviewState: string | null; _status: string; title: string }
}

test.describe('send for approval — school manager', () => {
  test.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  let fixture: Fixture
  test.beforeEach(async ({ baseURL }) => {
    fixture = await makePage(baseURL)
  })
  test.afterEach(async () => {
    await dropPage(fixture)
  })

  test('@smoke one button, no draft or publish, and sending queues the page without publishing it', async ({
    page,
  }) => {
    await openPage(page, fixture.id)

    const controls = page.locator('.doc-controls')
    await expect(controls.getByRole('button', SEND)).toBeVisible()
    await expect(controls.getByRole('button', { name: /publish/i })).toHaveCount(0)
    await expect(controls.getByRole('button', { name: /save/i })).toHaveCount(0)
    // Rendered text, not `textContent`: Payload's status is still in the DOM, hidden for this
    // role by `send-for-approval.css`. If a Payload bump renames its classes, this is what fails.
    expect(await controls.innerText()).not.toMatch(/draft|published/i)
    await expect(
      page.getByRole('status').filter({ hasText: 'Your changes save automatically' }),
    ).toBeVisible()

    const sent = page.waitForResponse(
      (res) => res.url().includes(`/api/pages/${fixture.id}`) && res.request().method() === 'PATCH',
    )
    await controls.getByRole('button', SEND).click()
    expect((await sent).ok(), 'the send is accepted').toBe(true)

    await expect(
      page.getByRole('status').filter({ hasText: /^Sent for approval on / }),
    ).toBeVisible()

    const stored = await latestDraft(fixture)
    expect(stored.reviewState).toBe('submitted')
    expect(stored._status).toBe('draft')

    // Never published, so the school's site does not have it.
    const live = await page.request.get(
      siteUrl(test.info().project.use.baseURL, SCHOOL_HOSTNAME, fixture.slug),
    )
    expect(live.status()).toBe(404)
  })

  test("a page sent back shows the district's note and what to do next", async ({ page }) => {
    // Sent by the school (a district admin asking for `submitted` is refused). Through the API:
    // sending through the button is what the first test proves.
    const asSchool = await page.request.patch(`/api/pages/${fixture.id}?draft=true`, {
      data: { reviewState: 'submitted' },
    })
    expect(asSchool.ok()).toBe(true)
    const sentBack = await fixture.admin.patch(`/api/pages/${fixture.id}?draft=true`, {
      data: { reviewState: 'changes-requested', reviewNote: 'Please add the return date.' },
    })
    expect(sentBack.ok(), await sentBack.text()).toBe(true)

    await openPage(page, fixture.id)
    const status = page.getByRole('status').filter({ hasText: 'The district asked for changes' })
    await expect(status).toContainText('Please add the return date.')
    await expect(status).toContainText('send it for approval again')
    await expect(page.locator('.doc-controls').getByRole('button', SEND)).toBeVisible()
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`in the ${colorScheme} theme`, () => {
      test.use({ colorScheme })

      test('@smoke @a11y the controls and status have zero critical or serious axe violations', async ({
        page,
      }) => {
        await page.request.patch(`/api/pages/${fixture.id}?draft=true`, {
          data: { reviewState: 'submitted' },
        })
        await fixture.admin.patch(`/api/pages/${fixture.id}?draft=true`, {
          data: { reviewState: 'changes-requested', reviewNote: 'Please add the return date.' },
        })
        await openPage(page, fixture.id)
        // The note is the longest state the status line has; audit that one.
        await expect(
          page.getByRole('status').filter({ hasText: 'Please add the return date.' }),
        ).toBeVisible()
        /**
         * Scoped to what this PR adds, as the other admin specs scope to their fields. The rest
         * of `.doc-controls` is Payload's, and fails on its own: the "more options" button has
         * no accessible name (button-name, critical). Not hidden here — tracked separately.
         */
        await expectNoBlockingViolations(page, '#action-send-for-approval')
        await expectNoBlockingViolations(page, '#review-status')
      })
    })
  }
})

adminTest.describe('send for approval — district admin', () => {
  adminTest.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  adminTest(
    "@smoke keeps Payload's own publish control — the district plane is unchanged",
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL)
      try {
        await openPage(page, fixture.id)
        const controls = page.locator('.doc-controls')
        await expect(controls.getByRole('button', { name: /publish/i }).first()).toBeVisible()
        await expect(controls.getByRole('button', SEND)).toHaveCount(0)
      } finally {
        await dropPage(fixture)
      }
    },
  )
})
