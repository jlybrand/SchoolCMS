import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, adminTest } from './support/admin-session'
import { followLink } from './support/follow-link'
import { uniqueTitle } from './support/fixture-pages'
import { schoolTest, tenantIdFor } from './support/school-session'

/**
 * The file library (Jason, 2026-11-17): a site's folders, its files, and a file's details in
 * place — edit, move, replace, where it's used, and delete behind a pop-up that lists where it's
 * used. Both planes; the district chooses a site first. Built, then locked here (CLAUDE.md: admin
 * views are not test-first); the rules are `tests/unit/admin/file-library.test.ts` and
 * `tests/integration/file-library.test.ts`.
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

/** Nothing under 15px (Jason, 2026-11-17). */
const smallestText = async (page: Page) =>
  Math.min(
    ...(await page
      .locator('#file-library')
      .locator('p, a, span, li, label, input, select, textarea, button')
      .evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => parseFloat(getComputedStyle(el).fontSize)),
      )),
  )

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNkYGD4z8DAwMDAwMAAAAgPAQBJpJ4YAAAAAElFTkSuQmCC',
  'base64',
)

type Fixture = {
  admin: APIRequestContext
  tenant: number
  menus: { id: number; name: string }
  forms: { id: number; name: string }
  image: number
  imageTitle: string
  page: number
  pageTitle: string
}

const ok = async (res: Awaited<ReturnType<APIRequestContext['post']>>) => {
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json()).doc as { id: number }
}

const setUp = async (baseURL: string | undefined): Promise<Fixture> => {
  const admin = await playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })
  const tenant = await tenantIdFor(admin, 'a.localhost')
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const folder = async (name: string) => {
    const made = await ok(
      await admin.post('/api/resource-folders?depth=0', { data: { tenant, name } }),
    )
    return { id: made.id, name }
  }
  const menus = await folder(`Menus ${stamp}`)
  const forms = await folder(`Forms ${stamp}`)
  const imageTitle = uniqueTitle('Library photo')
  const image = (
    await ok(
      await admin.post('/api/resources?depth=0', {
        multipart: {
          file: { name: `library-${stamp}.png`, mimeType: 'image/png', buffer: PNG },
          _payload: JSON.stringify({
            tenant,
            folder: menus.id,
            title: imageTitle,
            alt: 'The gym',
          }),
        },
      }),
    )
  ).id
  const pageTitle = uniqueTitle('Library page')
  const page = (
    await ok(
      await admin.post('/api/pages?depth=0', {
        data: {
          tenant,
          title: pageTitle,
          slug: `library-${stamp}`,
          visibility: 'public',
          layout: [{ blockType: 'image', image }],
          _status: 'published',
        },
      }),
    )
  ).id
  return { admin, tenant, menus, forms, image, imageTitle, page, pageTitle }
}

const tearDown = async ({ admin, page, image, menus, forms }: Fixture) => {
  await admin.delete(`/api/pages/${page}`)
  await admin.delete(`/api/resources/${image}`)
  for (const f of [menus, forms]) await admin.delete(`/api/resource-folders/${f.id}`)
  await admin.dispose()
}

const stored = async (admin: APIRequestContext, id: number) => {
  const res = await admin.get(`/api/resources/${id}?depth=0`)
  return res.ok() ? ((await res.json()) as Record<string, unknown>) : null
}

/** From the folder tree to the file's details; focus lands on its heading. */
const openFile = async (page: Page, fixture: Fixture) => {
  const tree = page.getByRole('navigation', { name: 'Folders' })
  await followLink(
    page,
    tree.getByRole('link', { name: fixture.menus.name }),
    /\/admin\/file-library$/,
  )
  await page.getByRole('link', { name: fixture.imageTitle }).click()
  const heading = page.getByRole('heading', { level: 2, name: fixture.imageTitle })
  await expect(heading).toBeVisible({ timeout: 20_000 })
  await expect(heading).toBeFocused()
}

schoolTest.describe('a school’s file library', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest(
    `@a11y from the menu to a file’s details, with where it’s used`,
    async ({ page, baseURL }) => {
      const fixture = await setUp(baseURL)
      try {
        // A card on the school's start screen (Jason, 2026-11-17), and in the side menu.
        await page.goto('/admin')
        await expect(
          page.locator('#school-home').getByRole('link', { name: /Manage your files/ }),
        ).toHaveAttribute('href', '/admin/file-library', { timeout: 20_000 })
        // Files in their menu opens their folders beside it (Jason, 2026-11-18).
        await expect(page.locator('#nav-file-library')).toHaveAttribute(
          'aria-controls',
          'site-flyout',
        )
        await page.goto('/admin/file-library')
        await expect(page.getByRole('heading', { level: 1, name: 'File library' })).toBeVisible()
        // In Payload's frame (Jason, 2026-11-17): the side menu is on the library itself.
        await expect(page.locator('#nav-file-library')).toBeAttached()
        expect(await blockingViolations(page)).toEqual([])

        await openFile(page, fixture)
        await expect(page.locator('#library-used-on')).toContainText(fixture.pageTitle)
        await expect(page.locator('#replace-used-on')).toHaveText('Used on 1 page.')
        expect(await blockingViolations(page)).toEqual([])
        expect(await smallestText(page)).toBeGreaterThanOrEqual(15)
      } finally {
        await tearDown(fixture)
      }
    },
  )

  schoolTest('edit the details, then move it to another folder', async ({ page, baseURL }) => {
    const fixture = await setUp(baseURL)
    try {
      await page.goto('/admin/file-library')
      await openFile(page, fixture)
      const details = page.locator('#file-details')

      // An emptied description is refused beside the field.
      await details.getByLabel('Describe the image').fill('')
      await details.getByRole('button', { name: 'Save' }).click()
      await expect(details.getByLabel('Describe the image')).toBeFocused()
      await expect(details).toContainText('Describe the image for people who can’t see it')

      await details.getByLabel('Title (required)').fill(`${fixture.imageTitle} 2026`)
      await details.getByLabel('Describe the image').fill('The new gym')
      await details.getByLabel('Tags').fill('gym, sports')
      await details.getByRole('button', { name: 'Save' }).click()
      await expect(details.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible({
        timeout: 20_000,
      })
      await expect
        .poll(async () => (await stored(fixture.admin, fixture.image))?.title)
        .toBe(`${fixture.imageTitle} 2026`)
      expect(await stored(fixture.admin, fixture.image)).toMatchObject({
        alt: 'The new gym',
        tagsText: 'gym, sports',
      })

      await details.getByLabel('Move to').selectOption({ label: fixture.forms.name })
      await details.getByRole('button', { name: 'Move' }).click()
      await expect(details.getByRole('status').filter({ hasText: 'Moved.' })).toBeVisible({
        timeout: 20_000,
      })
      await expect
        .poll(async () => (await stored(fixture.admin, fixture.image))?.folder)
        .toBe(fixture.forms.id)
    } finally {
      await tearDown(fixture)
    }
  })

  schoolTest(
    '@a11y deleting a used file: the pop-up lists where; Cancel keeps it; Delete anyway removes it',
    async ({ page, baseURL }) => {
      const fixture = await setUp(baseURL)
      try {
        await page.goto('/admin/file-library')
        await openFile(page, fixture)

        await page.getByRole('button', { name: 'Delete this file' }).click()
        const dialog = page.getByRole('dialog', { name: `Delete “${fixture.imageTitle}”?` })
        await expect(dialog).toBeVisible()
        await expect(dialog).toContainText(fixture.pageTitle)
        // Cancel first, so Enter never deletes by accident.
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
        expect(await blockingViolations(page)).toEqual([])

        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await expect(dialog).toBeHidden()
        expect(await stored(fixture.admin, fixture.image)).not.toBeNull()

        await page.getByRole('button', { name: 'Delete this file' }).click()
        await dialog.getByRole('button', { name: 'Delete anyway' }).click()
        await expect(page.getByRole('status').filter({ hasText: 'File deleted.' })).toBeVisible({
          timeout: 20_000,
        })
        expect(await stored(fixture.admin, fixture.image)).toBeNull()
        await expect(page.getByRole('link', { name: fixture.imageTitle })).toHaveCount(0)
      } finally {
        await tearDown(fixture)
      }
    },
  )

  schoolTest('on a narrow screen the details take the screen', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const fixture = await setUp(baseURL)
    try {
      await page.goto(`/admin/file-library?folder=${fixture.menus.id}&file=${fixture.image}`)
      await expect(page.locator('#file-details')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('navigation', { name: 'Folders' })).toBeHidden()
      await page.getByRole('link', { name: 'Back to the files' }).click()
      await expect(page.getByRole('link', { name: fixture.imageTitle })).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    } finally {
      await tearDown(fixture)
    }
  })
})

adminTest.describe('the district’s file library', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest(`@a11y chooses a site first, then a file`, async ({ page, baseURL }) => {
    const fixture = await setUp(baseURL)
    try {
      await page.goto('/admin/file-library')
      await expect(page.getByText('Choose a folder to see its files.')).toBeVisible({
        timeout: 20_000,
      })
      expect(await blockingViolations(page)).toEqual([])

      // The list that slides out of the menu (Jason, 2026-11-18), not a select: EVERY folder,
      // under its site's name, then the folder's files in their place.
      await page.locator('#library-change-site').click()
      const panel = page.locator('#site-flyout')
      await expect(panel.getByRole('heading', { level: 2, name: 'Files' })).toBeFocused()
      await expect(panel).toContainText('Choose a folder')
      const schoolA = panel.getByRole('region', { name: 'School A', exact: true })
      const folder = schoolA.getByRole('button', { name: fixture.menus.name, exact: true })
      await expect(folder).toBeVisible({ timeout: 20_000 })
      expect(await blockingViolations(page)).toEqual([])
      await folder.click()
      await expect(panel.getByRole('heading', { name: fixture.menus.name })).toBeFocused()
      await expect(panel).toContainText('School A')
      const file = panel.getByRole('link', { name: new RegExp(`^${fixture.imageTitle}`) })
      await expect(file).toContainText('Image', { timeout: 20_000 })
      expect(await blockingViolations(page)).toEqual([])
      // Back a level: the folders again.
      await panel.getByRole('button', { name: 'All folders' }).click()
      await expect(panel.getByRole('heading', { level: 2, name: 'Files' })).toBeFocused()
      await schoolA.getByRole('button', { name: fixture.menus.name, exact: true }).click()

      // A file opens in the library, in its folder, its details showing.
      await file.click()
      await expect(page).toHaveURL(
        new RegExp(
          `/admin/file-library\\?site=${fixture.tenant}&folder=${fixture.menus.id}&file=${fixture.image}$`,
        ),
      )
      await expect(panel).toBeHidden()
      await expect(page.getByRole('heading', { level: 2, name: fixture.imageTitle })).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.locator('#library-site')).toHaveText('School A')
      expect(await blockingViolations(page)).toEqual([])
      expect(await smallestText(page)).toBeGreaterThanOrEqual(15)
    } finally {
      await tearDown(fixture)
    }
  })
})
