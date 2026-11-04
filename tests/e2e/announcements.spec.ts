import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'

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

/** School A's "News" board, read as whoever `request` is. */
const newsBoardOf = async (request: APIRequestContext): Promise<number> => {
  const res = await request.get('/api/post-boards?where[name][equals]=News&limit=1&depth=0')
  const [board] = (await res.json()).docs as { id: number }[]
  expect(board, 'the seed gives School A a News board').toBeDefined()
  return board!.id
}

schoolTest.describe('post an announcement — school manager', () => {
  schoolTest.skip(credentials === null, SKIP)
  // In order: one test gives School A a second board for a while, and the others expect one.
  schoolTest.describe.configure({ mode: 'serial' })

  schoolTest(
    '@smoke from the task to the queue: headline, words, one button',
    async ({ page, baseURL }) => {
      await page.goto('/admin')
      await page.getByRole('link', { name: /Post an announcement/ }).click()
      // Their one board opens with the headline showing (Jason, 2026-11-04: announcements screen).
      await expect(page).toHaveURL(/\/admin\/collections\/posts\?new=1/, { timeout: 20_000 })
      const view = page.locator('#new-post')
      await expect(view.getByRole('heading', { name: 'New announcement' })).toBeVisible({
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
        /**
         * The send itself, not the autosave the typing set off — both PATCH this post. And
         * retried: under load the editor can hand its text to the form after the click, so the
         * button refuses an "empty" announcement and sends nothing. A second click sends it.
         */
        const sentStatus = page.getByRole('status').filter({ hasText: /^Sent for approval on / })
        await expect(async () => {
          if (await sentStatus.isVisible()) return
          const sent = page.waitForResponse(
            (res) =>
              res.url().includes(`/api/posts/${id}`) &&
              !res.url().includes('autosave=true') &&
              res.request().method() === 'PATCH',
            { timeout: 5_000 },
          )
          await controls.getByRole('button', SEND).click()
          expect((await sent).ok(), 'the send is accepted').toBe(true)
        }).toPass({ intervals: [500, 1_000], timeout: 30_000 })
        await expect(sentStatus).toBeVisible()

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
    'with two boards it asks which — chosen in the folders — and files the post there',
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
        // Two boards: none is assumed — the task lands on the folders to choose one.
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme })
          await page.goto('/admin/new-post')
          await expect(page.locator('#board-heading')).toHaveText('Choose a board', {
            timeout: 20_000,
          })
          await expect(page.locator('#new-post')).toHaveCount(0)
          await expectNoBlockingViolations(page, '#announcements')
        }

        const tree = page.getByRole('navigation', { name: 'Folders and boards' })
        // Retried: Payload rewrites a list's address just after it loads and re-renders the
        // screen, which can eat a click and close the folder just opened.
        await expect(async () => {
          const athletics = tree.locator('details').filter({ hasText: 'Athletics' })
          if ((await athletics.getAttribute('open')) === null) {
            await athletics.locator('summary').click({ timeout: 5_000 })
          }
          await athletics.getByRole('link', { name: 'Scores' }).click({ timeout: 5_000 })
          await expect(page.locator('#board-heading')).toHaveText('Athletics → Scores', {
            timeout: 5_000,
          })
        }).toPass({ timeout: 30_000 })

        await page.locator('#create-post').click()
        const view = page.locator('#new-post')
        await view.getByLabel('What is the headline?').fill('Final score')
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

/**
 * The announcements screen (Jason, 2026-11-04) — Finalsite's Posts module: folders, a folder's
 * boards, a board's posts, "Create post" at the top right. Fixture posts are on School A's board.
 */
adminTest.describe('the announcements screen — district admin', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest(
    '@smoke every site’s folders; a board lists its posts; Create post starts one there',
    async ({ page, baseURL }) => {
      const title = uniqueTitle('Science fair')
      const post = await makePost(baseURL, { title })
      try {
        await page.goto('/admin/collections/posts')
        const tree = page.getByRole('navigation', { name: 'Folders and boards' })
        for (const site of ['School A', 'School B']) {
          await expect(tree.getByRole('heading', { name: site })).toBeVisible({ timeout: 20_000 })
        }
        await expect(page.locator('#board-heading')).toHaveText('Choose a board')

        const schoolA = tree.getByRole('region', { name: 'School A' })
        // Retried: Payload rewrites a list's address just after it loads and re-renders the
        // screen, which can eat a click and close the folder just opened.
        await expect(async () => {
          // The seed files School A's News in a folder named for the school.
          const folder = schoolA
            .locator('details')
            .filter({ has: page.locator('summary', { hasText: /^School A$/ }) })
          if ((await folder.getAttribute('open')) === null) {
            await folder.locator('summary').click({ timeout: 5_000 })
          }
          await schoolA.getByRole('link', { name: 'News' }).click({ timeout: 5_000 })
          await expect(page.locator('#board-heading')).toHaveText('School A → News', {
            timeout: 5_000,
          })
        }).toPass({ timeout: 30_000 })
        await expect(schoolA.getByRole('link', { name: 'News' })).toHaveAttribute(
          'aria-current',
          'page',
        )
        const row = page.getByRole('row', { name: new RegExp(title) })
        await expect(row).toContainText('Draft')
        await expect(row.getByRole('link', { name: title })).toHaveAttribute(
          'href',
          `/admin/collections/posts/${post.id}`,
        )

        // Create post: the headline here, focused; Cancel puts the screen back.
        await page.locator('#create-post').click()
        const headline = page.locator('#new-post').getByLabel('What is the headline?')
        await expect(headline).toBeFocused({ timeout: 20_000 })
        await expect(page.locator('#create-post')).toHaveCount(0)
        await page.locator('#new-post').getByRole('link', { name: 'Cancel' }).click()
        await expect(page.locator('#new-post')).toHaveCount(0, { timeout: 20_000 })
        await expect(page.locator('#create-post')).toBeVisible()
      } finally {
        await dropPost(post)
      }
    },
  )
})

schoolTest.describe('the announcements screen — school manager', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest(
    'shows their board in their words, with no other school',
    async ({ page, baseURL }) => {
      const title = uniqueTitle('Spirit week')
      const post = await makePost(baseURL, { title })
      try {
        // Named, not assumed: another test briefly gives School A a second board.
        await page.goto(`/admin/collections/posts?board=${await newsBoardOf(page.request)}`)
        await expect(page.locator('#board-heading')).toHaveText('School A → News', {
          timeout: 20_000,
        })
        const tree = page.getByRole('navigation', { name: 'Folders and boards' })
        await expect(tree.getByRole('heading', { name: 'School B' })).toHaveCount(0)
        await expect(tree.getByRole('link', { name: 'Manage folders and boards' })).toHaveCount(0)
        // `04` §2.1: no "draft", no "publish".
        await expect(page.getByRole('row', { name: new RegExp(title) })).toContainText(
          'Not sent yet',
        )
        await expect(page.locator('#announcements table')).not.toContainText(/draft|publish/i)
      } finally {
        await dropPost(post)
      }
    },
  )

  schoolTest('another school’s board in the address opens nothing', async ({ page, baseURL }) => {
    // School B's board, looked up as the district: the manager cannot read it to find it.
    const admin = await asDistrict(baseURL)
    const tenantB = await tenantIdFor(admin, 'b.localhost')
    const boards = await admin.get(
      `/api/post-boards?where[tenant][equals]=${tenantB}&limit=1&depth=0`,
    )
    const [boardB] = (await boards.json()).docs as { id: number }[]
    await admin.dispose()
    expect(boardB, 'the seed gives School B a board').toBeDefined()

    await page.goto(`/admin/collections/posts?board=${boardB!.id}&new=1`)
    await expect(page.locator('#board-heading')).toHaveText('That board can’t be opened', {
      timeout: 20_000,
    })
    await expect(page.locator('#create-post')).toHaveCount(0)
    await expect(page.locator('#new-post')).toHaveCount(0)
    await expect(page.locator('#announcements table')).toHaveCount(0)
  })
})
