import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { dropPage, makePage, schoolRequest, uniqueTitle } from './support/fixture-pages'
import { dropPost, makePost } from './support/fixture-posts'
import { schoolTest } from './support/school-session'

/**
 * Approving from the page or announcement itself (Jason, 2026-11-12): the queue's review — diff
 * panel, Approve, Request changes — on the document, so the reviewer who opened it need not go
 * back to the queue. Built, then locked here (CLAUDE.md: admin views are not test-first); the read
 * under it is `tests/integration/queue-item.test.ts`, approve itself `approve.test.ts`.
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

type Doc = { _status: string; reviewState: string | null; reviewNote?: string | null }

/** A page School A's manager has sent for approval. */
const sentPage = async (baseURL: string | undefined, title: string) => {
  const fixture = await makePage(baseURL, { title: uniqueTitle(title) })
  const school = await schoolRequest(baseURL)
  const sent = await school.patch(`/api/pages/${fixture.id}?draft=true`, {
    data: { reviewState: 'submitted' },
  })
  expect(sent.ok(), await sent.text()).toBe(true)
  await school.dispose()
  return fixture
}

adminTest.describe('reviewing on the page itself', () => {
  adminTest.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(
      `@a11y a waiting page shows the diff and approves from there — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const fixture = await sentPage(baseURL, 'Review here')
        const stored = async () =>
          (await (await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)).json()) as Doc
        try {
          await page.goto(`/admin/collections/pages/${fixture.id}`)
          const panel = page.locator('#document-review')
          await expect(panel).toBeVisible({ timeout: 20_000 })
          await expect(panel).toContainText('School A sent this page for approval.')
          await expect(panel.getByRole('heading', { name: fixture.title })).toBeVisible()
          // The way to the rest of the queue stays — in the panel and in the header.
          await expect(
            panel.getByRole('link', { name: 'Review in the approval queue' }),
          ).toHaveAttribute('href', `/admin/approvals#approval-pages-${fixture.id}`)
          await expect(page.locator('#action-review-in-queue')).toBeVisible()
          expect(await blockingViolations(page)).toEqual([])

          await panel.getByRole('button', { name: 'Approve and publish' }).click()
          await expect(page.getByText(/^Published\. “/).first()).toBeVisible({ timeout: 20_000 })
          await expect.poll(async () => (await stored())._status).toBe('published')
          expect((await stored()).reviewState ?? null).toBeNull()
          // The form reads what is true now: no review, and the page's own Publish changes.
          await expect(panel).toBeHidden({ timeout: 20_000 })
          await expect(page.locator('#action-publish')).toHaveText('Publish changes', {
            timeout: 20_000,
          })
        } finally {
          await dropPage(fixture)
        }
      },
    )
  }

  adminTest(
    'Request changes from the page sends it back with the note',
    async ({ page, baseURL }) => {
      const fixture = await sentPage(baseURL, 'Send back here')
      try {
        await page.goto(`/admin/collections/pages/${fixture.id}`)
        const panel = page.locator('#document-review')
        await panel.getByRole('button', { name: 'Request changes' }).click({ timeout: 20_000 })
        await panel.getByLabel('What needs to change?').fill('Add the bus times.')
        await panel.getByRole('button', { name: 'Send back to the school' }).click()
        await expect(page.getByText('Sent back to School A with your note.').first()).toBeVisible({
          timeout: 20_000,
        })
        await expect
          .poll(
            async () =>
              (
                (await (
                  await fixture.admin.get(`/api/pages/${fixture.id}?draft=true&depth=0`)
                ).json()) as Doc
              ).reviewState,
          )
          .toBe('changes-requested')
        await expect(panel).toBeHidden({ timeout: 20_000 })
      } finally {
        await dropPage(fixture)
      }
    },
  )

  adminTest('a waiting announcement offers its dates beside Approve', async ({ page, baseURL }) => {
    const fixture = await makePost(baseURL, { title: uniqueTitle('Review announcement') })
    const school = await schoolRequest(baseURL)
    try {
      const sent = await school.patch(`/api/posts/${fixture.id}?draft=true`, {
        data: { reviewState: 'submitted' },
      })
      expect(sent.ok(), await sent.text()).toBe(true)
      await page.goto(`/admin/collections/posts/${fixture.id}`)
      const panel = page.locator('#document-review')
      await expect(panel).toContainText('School A sent this announcement for approval.', {
        timeout: 20_000,
      })
      // Closed by default, as in the queue, so Approve stays one click.
      await panel.getByText('Set dates').click()
      await expect(panel.getByRole('group', { name: 'Start' })).toBeVisible()
      await expect(panel.getByRole('button', { name: 'Approve and publish' })).toBeVisible()
    } finally {
      await school.dispose()
      await dropPost(fixture)
    }
  })

  adminTest('a page not waiting has no review panel', async ({ page, baseURL }) => {
    const fixture = await makePage(baseURL, { title: uniqueTitle('Not waiting') })
    try {
      await page.goto(`/admin/collections/pages/${fixture.id}`)
      await expect(page.locator('#action-publish')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#document-review')).toHaveCount(0)
    } finally {
      await dropPage(fixture)
    }
  })
})

schoolTest.describe('the school that sent it', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('sees no review panel on its own waiting page', async ({ page, baseURL }) => {
    const fixture = await sentPage(baseURL, 'School view')
    try {
      await page.goto(`/admin/collections/pages/${fixture.id}`)
      await expect(page.locator('#action-send-for-approval')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#document-review')).toHaveCount(0)
    } finally {
      await dropPage(fixture)
    }
  })
})
