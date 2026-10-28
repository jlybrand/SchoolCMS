import AxeBuilder from '@axe-core/playwright'
import { randomBytes } from 'node:crypto'

import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'

import { adminCredentials, adminTest, ADMIN_STORAGE_STATE } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * `posts.routine` acting (Jason, 2026-10-28): a school manager holding the grant posts an
 * announcement through the school's own form, and it is live at once — the status says so, the
 * school's /news has it, and the district's dashboard lists it for spot-checking (`04` §4.3).
 *
 * A DEDICATED account holds the grant, never the shared school manager: other specs send
 * announcements as that manager and expect them to queue. It is at SCHOOL B, because
 * `announcements.spec.ts` briefly gives School A a second board, which would make this
 * holder's form ask which one.
 */

const HOLDER_SCHOOL = 'b.localhost'

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

const HOLDER_EMAIL = 'e2e-routine-holder@example.invalid'
const PASSWORD = `e2e-${randomBytes(18).toString('base64url')}`

const district = (baseURL: string | undefined) =>
  playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })

/** The holder, at School B, with `posts.routine` and a password this run knows. */
const ensureHolder = async (admin: APIRequestContext): Promise<number> => {
  const tenant = await tenantIdFor(admin, HOLDER_SCHOOL)
  const data = {
    name: 'Routine Holder',
    password: PASSWORD,
    roles: ['school-manager'],
    tenants: [{ tenant }],
    autoApprove: ['posts.routine'],
  }
  const found = await admin.get(
    `/api/users?where[email][equals]=${encodeURIComponent(HOLDER_EMAIL)}&limit=1&depth=0`,
  )
  const [existing] = (await found.json()).docs as { id: number }[]
  const res = existing
    ? await admin.patch(`/api/users/${existing.id}`, { data })
    : await admin.post('/api/users', { data: { ...data, email: HOLDER_EMAIL } })
  expect(res.ok(), `upsert holder: ${res.status()} ${await res.text()}`).toBe(true)
  return existing ? existing.id : ((await res.json()).doc as { id: number }).id
}

adminTest.describe('posts.routine — an announcement live without waiting', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest(
    '@smoke the holder posts through the school form; it is live; the district can spot-check it',
    async ({ browser, page, baseURL }) => {
      const admin = await district(baseURL)
      const holderId = await ensureHolder(admin)
      const school = await browser.newContext({ ...(baseURL ? { baseURL } : {}) })
      const schoolPage = await school.newPage()
      const title = uniqueTitle('Bake sale')
      let postId: string | null = null
      try {
        const login = await schoolPage.request.post('/api/users/login', {
          data: { email: HOLDER_EMAIL, password: PASSWORD },
        })
        expect(login.ok(), await login.text()).toBe(true)

        // ── The school ─────────────────────────────────────────────────────────────────
        await schoolPage.goto('/admin/new-post')
        const view = schoolPage.locator('#new-post')
        const headline = view.getByLabel('What is the headline?')
        await expect(headline).toBeEditable({ timeout: 20_000 })
        await headline.fill(title)
        await view.getByRole('button', { name: 'Write the announcement' }).click()
        await schoolPage.waitForURL(/\/admin\/collections\/posts\/\d+/, { timeout: 20_000 })
        postId = /\/collections\/posts\/(\d+)/.exec(schoolPage.url())?.[1] ?? null

        const editor = schoolPage.locator('[contenteditable="true"]')
        await expect(editor).toHaveCount(1, { timeout: 20_000 })
        await expect(async () => {
          await editor.click()
          await editor.pressSequentially('Friday after school, in the cafeteria.')
          await expect(editor).toContainText('cafeteria', { timeout: 1_000 })
        }).toPass({ timeout: 15_000 })

        await schoolPage
          .locator('.doc-controls')
          .getByRole('button', { name: 'Send for approval' })
          .click()
        await expect(
          schoolPage.getByRole('status').filter({ hasText: 'This is live on the website' }),
        ).toBeVisible({ timeout: 20_000 })

        // ── The public site ────────────────────────────────────────────────────────────
        await expect(async () => {
          await page.goto(siteUrl(baseURL, HOLDER_SCHOOL, '/news'))
          await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 1_000 })
        }).toPass({ timeout: 15_000 })

        // ── The district's spot-check list ─────────────────────────────────────────────
        await page.goto('/admin')
        const panel = page.locator('#grants-panel')
        await expect(
          panel.getByRole('heading', { name: 'Auto-approved in the last 30 days' }),
        ).toBeVisible({ timeout: 20_000 })
        const row = panel.getByRole('listitem').filter({ hasText: title })
        await expect(row).toContainText(HOLDER_EMAIL)
        await expect(row.getByRole('link', { name: title })).toHaveAttribute(
          'href',
          `/admin/collections/posts/${postId}`,
        )
        const results = await new AxeBuilder({ page })
          .include('#grants-panel')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
        expect(
          results.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? '')),
        ).toEqual([])
      } finally {
        if (postId) await admin.delete(`/api/posts/${postId}`)
        await admin.patch(`/api/users/${holderId}`, { data: { autoApprove: [] } })
        await school.close()
        await admin.dispose()
      }
    },
  )
})
