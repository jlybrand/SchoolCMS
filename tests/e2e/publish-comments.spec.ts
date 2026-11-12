import AxeBuilder from '@axe-core/playwright'
import { expect, type APIRequestContext, type Page } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { dropPage, makePage, openPage, schoolRequest, uniqueTitle } from './support/fixture-pages'
import { dropPost, makePost } from './support/fixture-posts'
import { schoolTest } from './support/school-session'

/**
 * The optional comment on Publish, Schedule and Send for approval (Jason, 2026-11-12): in the
 * Publish dialog (pages and announcements), in a box beside the school's Send for approval, and
 * beside Approve in the queue — kept on the activity-log entry, and the school's shown to the
 * reviewer before the diff. Built, then locked here (CLAUDE.md: admin views are not test-first);
 * the rules are `tests/integration/change-comments.test.ts` and the unit suites.
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

/** The comment on the newest activity-log entry for a document and an action. */
const loggedComment = async (
  admin: APIRequestContext,
  collection: 'pages' | 'posts',
  id: number,
  action: string,
) => {
  const q =
    `/api/audit-events?depth=0&limit=1&sort=-createdAt` +
    `&where[contentType][equals]=${collection}&where[documentId][equals]=${id}` +
    `&where[action][equals]=${action}`
  const docs = ((await (await admin.get(q)).json()) as { docs: { comment?: string }[] }).docs
  return docs[0]?.comment ?? null
}

adminTest.describe('the district’s comment', () => {
  adminTest.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(
      `@a11y a comment in the Publish dialog is kept with the publish — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const fixture = await makePage(baseURL, { title: uniqueTitle('Commented page') })
        try {
          await openPage(page, fixture.id)
          await page.locator('#action-publish').click()
          const dialog = page.getByRole('dialog', { name: 'Publish this page' })
          const box = dialog.getByLabel('Comment')
          await expect(box).toBeVisible()
          await box.fill('Checked with the principal.')
          expect(await blockingViolations(page)).toEqual([])
          await dialog.getByRole('button', { name: 'Publish now' }).click()
          await expect
            .poll(() => loggedComment(fixture.admin, 'pages', fixture.id, 'publish'), {
              timeout: 20_000,
            })
            .toBe('Checked with the principal.')
        } finally {
          await dropPage(fixture)
        }
      },
    )
  }

  adminTest('an announcement gets the same dialog, comment and all', async ({ page, baseURL }) => {
    const post = await makePost(baseURL, { title: uniqueTitle('Commented announcement') })
    try {
      await page.goto(`/admin/collections/posts/${post.id}`)
      await page.locator('#action-publish').click({ timeout: 20_000 })
      const dialog = page.getByRole('dialog', { name: 'Publish this announcement' })
      await dialog.getByLabel('Comment').fill('For Friday’s assembly.')
      await dialog.getByRole('button', { name: 'Publish now' }).click()
      await expect
        .poll(() => loggedComment(post.admin, 'posts', post.id, 'publish'), { timeout: 20_000 })
        .toBe('For Friday’s assembly.')
    } finally {
      await dropPost(post)
    }
  })

  adminTest(
    'the queue shows the school’s note before the diff, and approving takes a comment',
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL, { title: uniqueTitle('Noted page') })
      const school = await schoolRequest(baseURL)
      try {
        const sent = await school.patch(`/api/pages/${fixture.id}?draft=true`, {
          data: { reviewState: 'submitted', changeComment: 'Spring bus times.' },
        })
        expect(sent.ok(), await sent.text()).toBe(true)
        await page.goto(`/admin/approvals#approval-pages-${fixture.id}`)
        const item = page.locator(`#approval-pages-${fixture.id}`)
        await expect(item.getByText('Note from School A')).toBeVisible({ timeout: 20_000 })
        await expect(item.getByText('Spring bus times.')).toBeVisible()
        await item.getByLabel('Comment').fill('Thanks, the times are clear.')
        await item.getByRole('button', { name: 'Approve and publish' }).click()
        await expect(item.getByRole('status')).toContainText('Published.', { timeout: 20_000 })
        expect(await loggedComment(fixture.admin, 'pages', fixture.id, 'approve')).toBe(
          'Thanks, the times are clear.',
        )
      } finally {
        await school.dispose()
        await dropPage(fixture)
      }
    },
  )
})

schoolTest.describe('the school’s note', () => {
  schoolTest.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    schoolTest(
      `@a11y a note beside Send for approval goes with the send — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const fixture = await makePage(baseURL, { title: uniqueTitle('School note') })
        try {
          await page.goto(`/admin/collections/pages/${fixture.id}`)
          const box = page.getByLabel('Note for the district')
          await expect(box).toBeVisible({ timeout: 20_000 })
          await box.fill('New lunch menu.')
          expect(await blockingViolations(page)).toEqual([])
          await page.locator('#action-send-for-approval').click()
          await expect
            .poll(() => loggedComment(fixture.admin, 'pages', fixture.id, 'submit'), {
              timeout: 20_000,
            })
            .toBe('New lunch menu.')
          // Sent: the box is cleared, ready for the next time.
          await expect(box).toHaveValue('')
        } finally {
          await dropPage(fixture)
        }
      },
    )
  }
})
