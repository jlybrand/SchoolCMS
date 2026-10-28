import { expect, request as playwrightRequest } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, adminTest } from './support/admin-session'
import { expectNoBlockingViolations, schoolRequest, uniqueTitle } from './support/fixture-pages'
import { dropPost, makePost } from './support/fixture-posts'
import { SCHOOL_HOSTNAME, schoolTest, tenantIdFor } from './support/school-session'

/**
 * "Post an announcement" (`04` §2.2), end to end: the school's task, the announcement's form,
 * the one button, the queue, the one-click approve.
 *
 * The lock-in CLAUDE.md's exception table requires for custom admin React. The pure decisions
 * are `tests/unit/admin/school-plane.test.ts`, `page-diff.test.ts` and `post-hooks.test.ts`;
 * the approve rule over real Payload is `tests/integration/approve.test.ts`.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

const SEND = { name: 'Send for approval' }

const asDistrict = (baseURL: string | undefined) =>
  playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })

const postIdFrom = (url: string) => /\/collections\/posts\/(\d+)/.exec(url)?.[1] ?? null

schoolTest.describe('post an announcement — school manager', () => {
  schoolTest.skip(credentials === null, SKIP)
  // In order: one test gives School A a second board for a while, and the others expect one.
  schoolTest.describe.configure({ mode: 'serial' })

  schoolTest(
    '@smoke from the task to the queue: headline, words, one button',
    async ({ page, baseURL }) => {
      await page.goto('/admin')
      await page.getByRole('link', { name: /Post an announcement/ }).click()
      const view = page.locator('#new-post')
      await expect(view.getByRole('heading', { level: 1 })).toHaveText('Post an announcement', {
        timeout: 20_000,
      })

      // Nothing typed: told in words, focus on the field.
      const start = view.getByRole('button', { name: 'Write the announcement' })
      await expect(async () => {
        await start.click()
        await expect(view.getByText('Give the announcement a headline.')).toBeVisible({
          timeout: 1_000,
        })
      }).toPass({ timeout: 15_000 })
      const headline = view.getByLabel('What is the headline?')
      await expect(headline).toBeFocused()

      const title = uniqueTitle('Picture day')
      await headline.fill(title)
      await start.click()
      await page.waitForURL(/\/admin\/collections\/posts\/\d+/, { timeout: 20_000 })
      const id = postIdFrom(page.url())
      const district = await asDistrict(baseURL)

      try {
        await expect(page.locator('#field-title')).toHaveValue(title, { timeout: 20_000 })
        const controls = page.locator('.doc-controls')
        await expect(controls.getByRole('button', SEND)).toBeVisible()
        await expect(controls.getByRole('button', { name: /publish/i })).toHaveCount(0)
        // Where it is shared and its date are the district's; the school never sees them.
        await expect(page.locator('#field-syndication__scope')).toHaveCount(0)
        await expect(page.locator('#field-publishedDate')).toHaveCount(0)

        // Sending it with no words — before the editor has even loaded — is stopped in words,
        // and the editor still takes typing after it (a refused submit used to lock it).
        await controls.getByRole('button', SEND).click()
        await expect(page.getByText('Write the announcement before sending it.')).toBeVisible()
        const stored = await district.get(`/api/posts/${id}?draft=true&depth=0`)
        expect(((await stored.json()) as { reviewState: string | null }).reviewState).not.toBe(
          'submitted',
        )

        // The body's editor, once it accepts input (as `paste-normalizer.spec.ts` finds it).
        const editor = page.locator('[contenteditable="true"]')
        await expect(editor).toHaveCount(1, { timeout: 20_000 })
        await expect(async () => {
          await editor.click()
          await editor.pressSequentially('Thursday, in the gym.')
          await expect(editor).toContainText('Thursday, in the gym.', { timeout: 1_000 })
        }).toPass({ timeout: 15_000 })
        const sent = page.waitForResponse(
          (res) => res.url().includes(`/api/posts/${id}`) && res.request().method() === 'PATCH',
        )
        await controls.getByRole('button', SEND).click()
        expect((await sent).ok(), 'the send is accepted').toBe(true)
        await expect(
          page.getByRole('status').filter({ hasText: /^Sent for approval on / }),
        ).toBeVisible()

        await page.goto('/admin')
        const row = page.locator('#school-home li').filter({ hasText: title })
        await expect(row).toContainText('Sent for approval', { timeout: 20_000 })
        await expect(row.getByRole('link', { name: title })).toHaveAttribute(
          'href',
          `/admin/collections/posts/${id}`,
        )
      } finally {
        if (id) await district.delete(`/api/posts/${id}`)
        await district.dispose()
      }
    },
  )

  schoolTest(
    'with two boards it asks which — named by folder — and files the post there',
    async ({ page, baseURL }) => {
      const district = await asDistrict(baseURL)
      const tenant = await tenantIdFor(district, SCHOOL_HOSTNAME)
      const folder = (
        await (
          await district.post('/api/post-folders', { data: { tenant, name: 'Athletics' } })
        ).json()
      ).doc as { id: number }
      const board = (
        await (
          await district.post('/api/post-boards', {
            data: { tenant, folder: folder.id, name: 'Scores' },
          })
        ).json()
      ).doc as { id: number }
      let postId: string | null = null
      try {
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          await page.goto('/admin/new-post')
          const view = page.locator('#new-post')
          await expect(async () => {
            await view.getByLabel('What is the headline?').fill('Final score')
            await view.getByRole('button', { name: 'Write the announcement' }).click()
            await expect(view.getByText('Choose which board this goes on.')).toBeVisible({
              timeout: 1_000,
            })
          }).toPass({ timeout: 20_000 })
          await expectNoBlockingViolations(page, '#new-post')
        }
        const view = page.locator('#new-post')
        await view.getByRole('radio', { name: 'Athletics → Scores' }).check()
        await view.getByRole('button', { name: 'Write the announcement' }).click()
        await page.waitForURL(/\/admin\/collections\/posts\/\d+/, { timeout: 20_000 })
        postId = postIdFrom(page.url())
        const stored = await district.get(`/api/posts/${postId}?draft=true&depth=0`)
        expect(((await stored.json()) as { board: number }).board).toBe(board.id)
      } finally {
        if (postId) await district.delete(`/api/posts/${postId}`)
        await district.delete(`/api/post-boards/${board.id}`)
        await district.delete(`/api/post-folders/${folder.id}`)
        await district.dispose()
      }
    },
  )

  for (const colorScheme of ['light', 'dark'] as const) {
    schoolTest(
      `@a11y the new-announcement screen, errors showing — ${colorScheme}`,
      async ({ page }) => {
        await page.emulateMedia({ colorScheme })
        await page.goto('/admin/new-post')
        const view = page.locator('#new-post')
        await expect(async () => {
          await view.getByRole('button', { name: 'Write the announcement' }).click()
          await expect(view.getByText('Give the announcement a headline.')).toBeVisible({
            timeout: 1_000,
          })
        }).toPass({ timeout: 20_000 })
        await expectNoBlockingViolations(page, '#new-post')
      },
    )
  }
})

adminTest.describe('an announcement in the approval queue — district admin', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest(
    '@smoke the diff names it an announcement, and one click publishes it',
    async ({ page, baseURL }) => {
      const title = uniqueTitle('Book fair')
      const post = await makePost(baseURL, { title })
      const school = await schoolRequest(baseURL)
      try {
        const sent = await school.patch(`/api/posts/${post.id}?draft=true`, {
          data: { reviewState: 'submitted' },
        })
        expect(sent.ok(), await sent.text()).toBe(true)

        await page.goto('/admin/approvals')
        const item = page.getByRole('article', { name: new RegExp(title) })
        await expect(item).toContainText('New announcement', { timeout: 20_000 })
        await expect(item.getByRole('row', { name: /^Headline/ })).toContainText(title)
        await expect(item.getByRole('link', { name: 'Open the announcement' })).toHaveAttribute(
          'href',
          `/admin/collections/posts/${post.id}`,
        )
        await expectNoBlockingViolations(page, '#approvals')

        await item.getByRole('button', { name: 'Approve and publish' }).click()
        await expect(item.getByRole('status')).toContainText('Published', { timeout: 15_000 })

        const live = await post.admin.get(`/api/posts/${post.id}?depth=0`)
        const doc = (await live.json()) as { _status: string; publishedDate: string | null }
        expect(doc._status).toBe('published')
        expect(doc.publishedDate).toBeTruthy()
      } finally {
        await school.dispose()
        await dropPost(post)
      }
    },
  )
})
