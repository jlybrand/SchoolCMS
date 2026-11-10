import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, adminTest } from './support/admin-session'
import { deletePage, expectNoBlockingViolations, uniqueTitle } from './support/fixture-pages'
import { SCHOOL_HOSTNAME, schoolTest, tenantIdFor } from './support/school-session'

/**
 * Schools compose (Jason, 2026-11-04, "level B"): on a page the district laid out, a school adds
 * and edits the simple components and sends the change; the district's components are not on
 * offer to add, and the queue shows the change as sections. The rule over every route is
 * `tests/integration/tenant-isolation.test.ts`; the rule itself `tests/unit/access/school-layout.test.ts`.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

const words = (value: string) => ({
  blockType: 'richText',
  content: {
    root: {
      type: 'root',
      direction: null,
      format: '',
      indent: 0,
      version: 1,
      children: [
        { type: 'paragraph', version: 1, children: [{ type: 'text', text: value, version: 1 }] },
      ],
    },
  },
})

const asDistrict = (baseURL: string | undefined) =>
  playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })

/** A published page on School A the district laid out: words, then a news feed. */
const districtPage = async (admin: APIRequestContext, title: string) => {
  const tenant = await tenantIdFor(admin, SCHOOL_HOSTNAME)
  const boards = await admin.get(`/api/post-boards?where[tenant][equals]=${tenant}&limit=1&depth=0`)
  const board = ((await boards.json()).docs as { id: number }[])[0]!.id
  const res = await admin.post('/api/pages?depth=0', {
    data: {
      tenant,
      title,
      slug: `composed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      visibility: 'public',
      layout: [
        words('Welcome to the library.'),
        { blockType: 'feed', heading: 'News', boards: [board] },
      ],
      _status: 'published',
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()).doc as { id: number }).id
}

schoolTest.describe('a school composes its page', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest(
    '@smoke adds a Text section from the simple components, and sends it for approval',
    async ({ page, baseURL }) => {
      const admin = await asDistrict(baseURL)
      const title = uniqueTitle('Library')
      const id = await districtPage(admin, title)
      try {
        await page.goto(`/admin/collections/pages/${id}`)
        await expect(page.locator('#field-title')).toHaveValue(title, { timeout: 20_000 })

        // The picker: the simple components — not the district's.
        const add = page.locator('#field-layout').getByRole('button', { name: /^Add / }).last()
        await expect(add).toBeVisible({ timeout: 20_000 })
        // The page already holds a Text section: count the editors now, so the new one is the
        // one past them — `.last()` alone resolves to the old editor before the new one mounts.
        const editors = page.locator('#field-layout .ContentEditable__root')
        await expect(editors.first()).toBeVisible({ timeout: 20_000 })
        const before = await editors.count()
        await add.click()
        const picker = page.getByRole('dialog').last()
        await expect(picker).toContainText('Text', { timeout: 10_000 })
        for (const kind of ['Columns', 'Video', 'Section menu']) {
          await expect(picker).not.toContainText(kind)
        }
        await picker
          .getByRole('button', { name: /^Text$/ })
          .first()
          .click()

        await expect(editors).toHaveCount(before + 1, { timeout: 10_000 })
        const editor = editors.nth(before)
        await expect(editor).toBeVisible({ timeout: 10_000 })
        await editor.click()
        await page.keyboard.type('Story time is on Fridays.')

        const send = page
          .locator('.doc-controls')
          .getByRole('button', { name: 'Send for approval' })
        await expect(send).toBeEnabled({ timeout: 20_000 })
        await send.click()
        await expect(
          page.getByRole('status').filter({ hasText: /^Sent for approval on / }),
        ).toBeVisible({ timeout: 20_000 })

        const stored = await admin.get(`/api/pages/${id}?draft=true&depth=0`)
        const doc = (await stored.json()) as {
          reviewState: string
          layout: { blockType: string }[]
        }
        expect(doc.reviewState).toBe('submitted')
        expect(doc.layout.map((b) => b.blockType)).toEqual(['richText', 'feed', 'richText'])
      } finally {
        await deletePage(admin, id)
        await admin.dispose()
      }
    },
  )

  for (const colorScheme of ['light', 'dark'] as const) {
    schoolTest(
      `@a11y the school’s composed-page form — ${colorScheme}`,
      async ({ page, baseURL }) => {
        const admin = await asDistrict(baseURL)
        const id = await districtPage(admin, uniqueTitle('Axe composed'))
        try {
          await page.emulateMedia({ colorScheme })
          await page.goto(`/admin/collections/pages/${id}`)
          await expect(page.locator('#field-layout')).toBeVisible({ timeout: 20_000 })
          await expect(
            page.locator('.collapsible__drag[aria-label="Reorder"]').first(),
          ).toBeAttached({
            timeout: 20_000,
          })
          // The news feed's chosen board: its clear button is taken out of the tab order by the
          // patch (`A11yPatch`). Axe before that lands reports aria-hidden-focus.
          await expect(
            page.locator(
              '#field-layout__1__boards .clear-indicator[aria-hidden="true"][tabindex="-1"]',
            ),
          ).toBeAttached({ timeout: 20_000 })
          await expectNoBlockingViolations(page, '#field-layout')
        } finally {
          await deletePage(admin, id)
          await admin.dispose()
        }
      },
    )
  }
})

adminTest.describe('the district sees a school’s sections in the queue', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest('an added section reads as one line: Added Text', async ({ page, baseURL }) => {
    const admin = await asDistrict(baseURL)
    const title = uniqueTitle('Gym')
    const id = await districtPage(admin, title)
    const school = await playwrightRequest.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: 'tests/.auth/school-manager.json',
    })
    try {
      const live = (await (await admin.get(`/api/pages/${id}?depth=0`)).json()) as {
        layout: unknown[]
      }
      const sent = await school.patch(`/api/pages/${id}?draft=true`, {
        data: {
          layout: [...live.layout, words('Open gym on Saturdays.')],
          reviewState: 'submitted',
        },
      })
      expect(sent.ok(), await sent.text()).toBe(true)

      await page.goto('/admin/approvals')
      const item = page.getByRole('article', { name: new RegExp(title) })
      await expect(item).toContainText('Added Text: Open gym on Saturdays.', { timeout: 20_000 })
      await expect(item).toContainText('(2 sections unchanged)')
      await expectNoBlockingViolations(page, '#approvals')
    } finally {
      await school.dispose()
      await deletePage(admin, id)
      await admin.dispose()
    }
  })
})
