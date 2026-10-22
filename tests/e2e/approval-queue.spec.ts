import { expect, type APIRequestContext } from '@playwright/test'

import { adminCredentials, adminTest as test } from './support/admin-session'
import {
  dropPage,
  expectNoBlockingViolations,
  makePage,
  schoolRequest,
  uniqueTitle,
  type FixturePage,
} from './support/fixture-pages'
import { SCHOOL_HOSTNAME, schoolTest } from './support/school-session'

/**
 * The district's approval queue (`04` §4.2) and the Phase 4 exit (`05`): "the district
 * approves from a diff in one click and it goes live within seconds".
 *
 * The lock-in CLAUDE.md's exception table requires for custom admin React. The rules beneath
 * — the version token, the diff, the note check, the wait — are unit-tested; approve against
 * real Payload is `tests/integration/approve-page.test.ts`. This drives the screen.
 *
 * Each test makes its own page, PUBLISHES it, then has the school change and send it, so the
 * queue shows a real before/after and the public site has an old version to replace.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

type Sent = FixturePage & { school: APIRequestContext; newTitle: string }

/** Published with one title; then the school retitles it and sends it for approval. */
const publishedThenSent = async (baseURL: string | undefined): Promise<Sent> => {
  const fixture = await makePage(baseURL, { title: uniqueTitle('Bus routes') })
  const published = await fixture.admin.patch(`/api/pages/${fixture.id}`, {
    data: { _status: 'published' },
  })
  expect(published.ok(), await published.text()).toBe(true)

  const school = await schoolRequest(baseURL)
  const newTitle = `${fixture.title} and times`
  const sent = await school.patch(`/api/pages/${fixture.id}?draft=true`, {
    data: { title: newTitle, reviewState: 'submitted' },
  })
  expect(sent.ok(), await sent.text()).toBe(true)
  return { ...fixture, school, newTitle }
}

const drop = async (sent: Sent) => {
  await sent.school.dispose()
  await dropPage(sent)
}

const publicUrl = (slug: string) => `http://${SCHOOL_HOSTNAME}:3000/${slug}`

test.describe('approval queue — district admin', () => {
  test.skip(credentials === null, SKIP)

  test('@smoke one click from the diff publishes, and the school site has it within seconds', async ({
    page,
    baseURL,
  }) => {
    const sent = await publishedThenSent(baseURL)
    try {
      // Render the public page once so its cache holds the OLD title — the thing to replace.
      const before = await page.request.get(publicUrl(sent.slug))
      expect(await before.text()).toContain(sent.title)

      await page.goto('/admin/approvals')
      const item = page.getByRole('article', { name: sent.newTitle })
      await expect(item).toBeVisible({ timeout: 20_000 })
      await expect(item).toContainText('School A')
      await expect(item).toContainText('e2e-school-a@example.invalid')
      await expect(item).toContainText('Sent today')

      const titleRow = item.getByRole('row', { name: /^Title/ })
      await expect(titleRow).toContainText(sent.title)
      await expect(titleRow).toContainText(sent.newTitle)

      await item.getByRole('button', { name: 'Approve and publish' }).click()
      await expect(item.getByRole('status')).toContainText('Published', { timeout: 15_000 })
      await expect(item.getByRole('status')).toBeFocused()

      await expect
        .poll(async () => (await page.request.get(publicUrl(sent.slug))).text(), {
          timeout: 15_000,
          message: 'the approved title reaches the public page within seconds',
        })
        .toContain(sent.newTitle)
    } finally {
      await drop(sent)
    }
  })

  test('refuses to approve a page the school changed after the queue was opened', async ({
    page,
    baseURL,
  }) => {
    const sent = await publishedThenSent(baseURL)
    try {
      await page.goto('/admin/approvals')
      const item = page.getByRole('article', { name: sent.newTitle })
      await expect(item).toBeVisible({ timeout: 20_000 })

      // The school keeps editing while the reviewer reads.
      const edited = await sent.school.patch(`/api/pages/${sent.id}?draft=true&autosave=true`, {
        data: { title: `${sent.newTitle} — edited during review` },
      })
      expect(edited.ok()).toBe(true)

      await item.getByRole('button', { name: 'Approve and publish' }).click()
      const alert = item.getByRole('alert')
      await expect(alert).toContainText('changed after you opened it', { timeout: 15_000 })
      await expect(alert.getByRole('button', { name: 'Reload the queue' })).toBeVisible()

      const live = await page.request.get(publicUrl(sent.slug))
      expect(await live.text()).not.toContain('edited during review')
    } finally {
      await drop(sent)
    }
  })

  test('request changes needs a note, then sends the page back with it', async ({
    page,
    baseURL,
  }) => {
    const sent = await publishedThenSent(baseURL)
    try {
      await page.goto('/admin/approvals')
      const item = page.getByRole('article', { name: sent.newTitle })
      await expect(item).toBeVisible({ timeout: 20_000 })

      await item.getByRole('button', { name: 'Request changes' }).click()
      const note = item.getByLabel('What needs to change?')
      await expect(note).toBeFocused()

      await item.getByRole('button', { name: 'Send back to the school' }).click()
      await expect(item).toContainText('Say what needs to change')
      await expect(note).toHaveAttribute('aria-invalid', 'true')
      await expect(note).toBeFocused()

      await note.fill('Please add the return times.')
      await item.getByRole('button', { name: 'Send back to the school' }).click()
      await expect(item.getByRole('status')).toContainText('Sent back to School A', {
        timeout: 15_000,
      })

      const stored = await sent.admin.get(`/api/pages/${sent.id}?draft=true&depth=0`)
      const doc = (await stored.json()) as { reviewState: string; reviewNote: string }
      expect(doc.reviewState).toBe('changes-requested')
      expect(doc.reviewNote).toBe('Please add the return times.')
    } finally {
      await drop(sent)
    }
  })

  test('@smoke the dashboard says how many are waiting and links to the queue', async ({
    page,
  }) => {
    await page.goto('/admin')
    const banner = page.locator('#waiting-banner')
    await expect(banner).toContainText(/waiting for approval/, { timeout: 20_000 })
    await expect(page.getByRole('link', { name: 'Approvals' })).toBeVisible()
    await banner.getByRole('link', { name: 'Open the approval queue' }).click()
    await expect(page).toHaveURL(/\/admin\/approvals/)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@smoke @a11y the queue has zero critical or serious axe violations — ${colorScheme}`, async ({
      page,
      baseURL,
    }) => {
      const sent = await publishedThenSent(baseURL)
      try {
        await page.emulateMedia({ colorScheme })
        await page.goto('/admin/approvals')
        const item = page.getByRole('article', { name: sent.newTitle })
        await expect(item).toBeVisible({ timeout: 20_000 })
        // The note open, with its error showing: the most the item ever renders.
        await item.getByRole('button', { name: 'Request changes' }).click()
        await item.getByRole('button', { name: 'Send back to the school' }).click()
        await expect(item).toContainText('Say what needs to change')
        await expectNoBlockingViolations(page, '#approvals')

        await page.goto('/admin')
        await expect(page.locator('#waiting-banner')).toBeVisible({ timeout: 20_000 })
        await expectNoBlockingViolations(page, '#waiting-banner')
      } finally {
        await drop(sent)
      }
    })
  }
})

schoolTest.describe('approval queue — school manager', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('cannot open the queue', async ({ page }) => {
    await page.goto('/admin/approvals')
    await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 20_000 })
    await expect(page.locator('#approvals')).toHaveCount(0)
  })

  schoolTest('cannot approve through the API, whatever it sends', async ({ page, baseURL }) => {
    const sent = await publishedThenSent(baseURL)
    try {
      const res = await page.request.post(`/api/pages/${sent.id}/approve`, {
        data: { versionId: '1', updatedAt: new Date().toISOString() },
      })
      expect(res.status()).toBe(403)
      const live = await page.request.get(publicUrl(sent.slug))
      expect(await live.text()).not.toContain(sent.newTitle)
    } finally {
      await drop(sent)
    }
  })
})
