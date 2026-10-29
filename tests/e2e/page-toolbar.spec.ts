import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { SCHOOL_HOSTNAME, schoolTest, tenantIdFor } from './support/school-session'
import { openPageSettings } from './support/page-settings'
import { siteUrl } from './support/site-url'

/**
 * The district's page toolbar and Page settings dialog (Jason, 2026-10-29 — his Finalsite
 * workflow): the page's contents, and along the bottom History, Clone, Delete, Unpublish and a
 * gear that opens the settings — title, address (Jason pinned: the dialog edits the URL), place,
 * linked page and the rest. A school manager's form is unchanged.
 *
 * Built, then locked here (CLAUDE.md: admin views are not test-first). Fixtures on School B, whose
 * sitemap no spec counts.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'
const BLOCKING = ['critical', 'serious']

const asDistrict = (baseURL: string | undefined) =>
  playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })

const mkPage = async (admin: APIRequestContext, hostname: string, status = 'published') => {
  const slug = `toolbar-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const title = uniqueTitle('Toolbar page')
  const res = await admin.post('/api/pages?depth=0', {
    data: {
      tenant: await tenantIdFor(admin, hostname),
      title,
      slug,
      pageType: 'standard',
      visibility: 'public',
      _status: status,
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return { id: ((await res.json()).doc as { id: number }).id, slug, title }
}

const blockingViolations = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations
    .filter((v) => BLOCKING.includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)

const openForm = async (page: Page, id: number) => {
  await page.goto(`/admin/collections/pages/${id}`)
  await expect(page.locator('#page-toolbar')).toBeVisible({ timeout: 20_000 })
  // The editor is repaired by A11yPatch before anything is audited.
  await expect(page.locator('.ContentEditable__root[aria-label]').first()).toBeAttached({
    timeout: 20_000,
  })
}

test.describe('the district page toolbar', () => {
  test.skip(credentials === null, SKIP)
  test.use({ storageState: ADMIN_STORAGE_STATE })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@a11y shows the contents, and the gear opens Page settings — ${colorScheme}`, async ({
      page,
      baseURL,
    }) => {
      await page.emulateMedia({ colorScheme })
      const admin = await asDistrict(baseURL)
      const made = await mkPage(admin, 'b.localhost')
      try {
        await openForm(page, made.id)

        // Closed: the words are there, the settings are not.
        await expect(page.locator('#field-title')).toBeHidden()
        await expect(page.locator('.ContentEditable__root').first()).toBeVisible()
        for (const action of ['History', 'Clone', 'Delete', 'Page settings']) {
          await expect(
            page.locator('#page-toolbar').getByText(action, { exact: true }),
          ).toBeVisible()
        }
        expect(await blockingViolations(page)).toEqual([])

        // Open: a dialog, named, focused on its heading, holding the settings — the URL among them.
        const gear = page.getByRole('button', { name: 'Page settings' })
        const dialog = await openPageSettings(page)
        await expect(page.locator('#page-settings-title')).toBeFocused()
        for (const field of ['#field-title', '#field-slug', '#field-parent', '#field-linkMode']) {
          await expect(page.locator(field)).toBeVisible()
        }
        await expect(page.locator('.ContentEditable__root').first()).toBeHidden()
        // Payload builds a group's fields as they come near the view; scrolled to, they are there.
        await page.locator('#field-meta').scrollIntoViewIfNeeded()
        await expect(page.locator('[name="meta.title"]')).toBeVisible()
        await page.locator('#page-settings-footer').scrollIntoViewIfNeeded()
        await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
        expect(await blockingViolations(page)).toEqual([])

        // Escape closes it and gives focus back to the gear.
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
        await expect(gear).toBeFocused()
      } finally {
        await admin.delete(`/api/pages/${made.id}`)
        await admin.dispose()
      }
    })
  }

  test('changes the page’s address from the dialog', async ({ page, baseURL }) => {
    const admin = await asDistrict(baseURL)
    const made = await mkPage(admin, 'b.localhost')
    try {
      await openForm(page, made.id)
      await openPageSettings(page)
      /**
       * Kept by autosave, as every change on the page is. Payload's autosave ignores an edit that
       * lands before it mounts (see `page-autosave.spec.ts`), so this types again if nothing has
       * saved within a few seconds, as a person would.
       */
      const isAutosave = (res: { url(): string; ok(): boolean }) =>
        res.url().includes(`/api/pages/${made.id}`) &&
        res.url().includes('autosave=true') &&
        res.ok()
      let address = ''
      let saved = false
      for (let attempt = 1; attempt <= 5 && !saved; attempt += 1) {
        address = `${made.slug}-moved-${attempt}`
        const autosaved = page.waitForResponse(isAutosave, { timeout: 4_000 }).then(
          () => true,
          () => false,
        )
        await page.locator('#field-slug').fill(address)
        saved = await autosaved
      }
      expect(saved, 'the new address saved itself').toBe(true)
      await page.getByRole('button', { name: 'Done' }).click()
      const draft = (await (await admin.get(`/api/pages/${made.id}?draft=true`)).json()) as {
        slug: string
      }
      expect(draft.slug).toBe(address)
    } finally {
      await admin.delete(`/api/pages/${made.id}`)
      await admin.dispose()
    }
  })

  test('will not close on a page with no title, and says why', async ({ page, baseURL }) => {
    const admin = await asDistrict(baseURL)
    const made = await mkPage(admin, 'b.localhost')
    try {
      await openForm(page, made.id)
      await openPageSettings(page)
      await page.locator('#field-title').fill('')
      await page.getByRole('button', { name: 'Done' }).click()
      const dialog = page.getByRole('dialog', { name: 'Page settings' })
      await expect(dialog).toBeVisible()
      await expect(page.getByRole('alert').filter({ hasText: 'needs a title' })).toBeVisible()
      await expect(page.locator('#field-title')).toBeFocused()

      await page.locator('#field-title').fill('Named again')
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    } finally {
      await admin.delete(`/api/pages/${made.id}`)
      await admin.dispose()
    }
  })

  test('History opens the page’s versions', async ({ page, baseURL }) => {
    const admin = await asDistrict(baseURL)
    const made = await mkPage(admin, 'b.localhost')
    try {
      await openForm(page, made.id)
      await page.locator('#page-toolbar').getByText('History', { exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/collections/pages/${made.id}/versions`))
    } finally {
      await admin.delete(`/api/pages/${made.id}`)
      await admin.dispose()
    }
  })

  test('Clone opens a draft copy', async ({ page, baseURL }) => {
    const admin = await asDistrict(baseURL)
    const made = await mkPage(admin, 'b.localhost')
    let copy: string | null = null
    try {
      await openForm(page, made.id)
      await page.locator('#page-toolbar').getByText('Clone', { exact: true }).click()
      await expect(page).not.toHaveURL(new RegExp(`/pages/${made.id}$`), { timeout: 20_000 })
      copy = /\/pages\/(\d+)/.exec(page.url())?.[1] ?? null
      expect(copy).not.toBeNull()
      const doc = (await (await admin.get(`/api/pages/${copy}?draft=true`)).json()) as {
        title: string
        slug: string
        _status: string
      }
      expect(doc).toMatchObject({
        title: `${made.title} (copy)`,
        slug: `${made.slug}-copy`,
        _status: 'draft',
      })
    } finally {
      if (copy) await admin.delete(`/api/pages/${copy}`)
      await admin.delete(`/api/pages/${made.id}`)
      await admin.dispose()
    }
  })

  test('Delete asks first, then removes the page', async ({ page, baseURL }) => {
    const admin = await asDistrict(baseURL)
    const made = await mkPage(admin, 'b.localhost')
    try {
      await openForm(page, made.id)
      await page.locator('#page-toolbar').getByText('Delete', { exact: true }).click()
      await page.getByRole('button', { name: 'Delete the page' }).click()
      await expect(page).toHaveURL(/\/admin\/collections\/pages\/?(\?.*)?$/, { timeout: 20_000 })
      expect((await admin.get(`/api/pages/${made.id}`)).status()).toBe(404)
    } finally {
      await admin.delete(`/api/pages/${made.id}`).catch(() => null)
      await admin.dispose()
    }
  })

  test('Unpublish takes the page off the site at once', async ({ page, baseURL }) => {
    const admin = await asDistrict(baseURL)
    const visitor = await playwrightRequest.newContext()
    const made = await mkPage(admin, 'b.localhost')
    try {
      // Warm the cached page first.
      expect((await visitor.get(siteUrl(baseURL, 'b.localhost', `/${made.slug}`))).status()).toBe(
        200,
      )
      await openForm(page, made.id)
      await page.locator('#page-toolbar-unpublish').click()
      await page.getByRole('button', { name: 'Unpublish the page' }).click()
      await expect
        .poll(async () =>
          (await visitor.get(siteUrl(baseURL, 'b.localhost', `/${made.slug}`))).status(),
        )
        .toBe(404)
    } finally {
      await admin.delete(`/api/pages/${made.id}`)
      await admin.dispose()
      await visitor.dispose()
    }
  })
})

schoolTest.describe('a school manager’s page form', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('is unchanged: no toolbar, the fields where they were', async ({ page, baseURL }) => {
    const admin = await asDistrict(baseURL)
    const made = await mkPage(admin, SCHOOL_HOSTNAME, 'draft')
    try {
      await page.goto(`/admin/collections/pages/${made.id}`)
      await expect(page.locator('#field-title')).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#page-toolbar')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Page settings' })).toHaveCount(0)
    } finally {
      await admin.delete(`/api/pages/${made.id}`)
      await admin.dispose()
    }
  })
})
