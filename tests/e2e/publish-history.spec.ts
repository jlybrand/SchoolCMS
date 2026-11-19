import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { dropPage, makePage, uniqueTitle } from './support/fixture-pages'
import { dropPost, makePost } from './support/fixture-posts'
import { schoolTest } from './support/school-session'

/**
 * History as the publishes of the last year (Jason, 2026-11-12): how each went live, who, when,
 * and the comments, each opening the version it made — where Restore lives. Built, then locked
 * here (CLAUDE.md: admin views are not test-first); the rules are
 * `tests/unit/admin/publish-history.test.ts` and `tests/integration/publish-history.test.ts`.
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

adminTest.describe('a page’s History', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest(
    `@a11y lists its publishes, newest first, each opening its version`,
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL, { title: uniqueTitle('History page') })
      try {
        for (const comment of ['The first version.', 'Spring times added.']) {
          const res = await fixture.admin.patch(`/api/pages/${fixture.id}?depth=0`, {
            data: { _status: 'published', changeComment: comment },
          })
          expect(res.ok(), await res.text()).toBe(true)
        }
        await page.goto(`/admin/collections/pages/${fixture.id}/versions`)
        const history = page.locator('#publish-history')
        await expect(history.getByRole('heading', { name: 'History' })).toBeVisible({
          timeout: 20_000,
        })
        const rows = history.getByRole('listitem')
        await expect(rows).toHaveCount(2)
        await expect(rows.nth(0)).toContainText('Published')
        await expect(rows.nth(0)).toContainText('Spring times added.')
        await expect(rows.nth(1)).toContainText('The first version.')
        expect(await blockingViolations(page)).toEqual([])

        // The newest opens the version it made — Payload's own screen, where Restore is.
        await rows
          .nth(0)
          .getByRole('link', { name: /^Open this version/ })
          .click()
        await expect(page).toHaveURL(
          new RegExp(`/admin/collections/pages/${fixture.id}/versions/[^/]+$`),
        )
        await expect(page.getByRole('button', { name: /Restore/ }).first()).toBeVisible({
          timeout: 20_000,
        })
      } finally {
        await dropPage(fixture)
      }
    },
  )

  adminTest('nothing published yet says so', async ({ page, baseURL }) => {
    const fixture = await makePage(baseURL, { title: uniqueTitle('Never published') })
    try {
      await page.goto(`/admin/collections/pages/${fixture.id}/versions`)
      await expect(page.locator('#publish-history')).toContainText(
        'Nothing has been published in the last year.',
        { timeout: 20_000 },
      )
    } finally {
      await dropPage(fixture)
    }
  })

  adminTest(
    'an announcement’s tab is History, and lists its publishes',
    async ({ page, baseURL }) => {
      const post = await makePost(baseURL, { title: uniqueTitle('History announcement') })
      try {
        const res = await post.admin.patch(`/api/posts/${post.id}?depth=0`, {
          data: { _status: 'published', changeComment: 'For the newsletter.' },
        })
        expect(res.ok(), await res.text()).toBe(true)
        await page.goto(`/admin/collections/posts/${post.id}`)
        await page.getByRole('link', { name: 'History', exact: true }).click({ timeout: 20_000 })
        const history = page.locator('#publish-history')
        await expect(history).toContainText('For the newsletter.', { timeout: 20_000 })
      } finally {
        await dropPost(post)
      }
    },
  )
})

schoolTest.describe('a school manager', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('sees no history of a page', async ({ page, baseURL }) => {
    const fixture = await makePage(baseURL, { title: uniqueTitle('School history') })
    try {
      await fixture.admin.patch(`/api/pages/${fixture.id}?depth=0`, {
        data: { _status: 'published', changeComment: 'District only.' },
      })
      await page.goto(`/admin/collections/pages/${fixture.id}/versions`)
      await expect(page.getByText('District only.')).toHaveCount(0)
      await expect(page.getByRole('link', { name: /^Open this version/ })).toHaveCount(0)
    } finally {
      await dropPage(fixture)
    }
  })
})
