import AxeBuilder from '@axe-core/playwright'
import { expect, request as playwrightRequest, type Page } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, adminTest } from './support/admin-session'
import { deletePage, makePage, uniqueTitle } from './support/fixture-pages'
import { dropPost, makePost } from './support/fixture-posts'
import { SCHOOL_HOSTNAME, schoolTest, tenantIdFor } from './support/school-session'

/**
 * The side navigation, district and school managers (Jason, 2026-11-13; scope settled and
 * extended 2026-11-18): a short menu of actions, Payload's collection groups folded under
 * "Everything else", and a panel beside the menu that drills down in place — Pages: a site → its
 * pages (a school manager starts on their school's); Announcements: every board → its posts; Events: every
 * calendar; Files: every folder → its files. Built, then locked here (CLAUDE.md: admin views are not test-first).
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

const smallestText = (page: Page, selector: string) =>
  page
    .locator(selector)
    .locator('p, a, span, li, button, label')
    .evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null && el.textContent?.trim())
        .map((el) => parseFloat(getComputedStyle(el).fontSize)),
    )
    .then((sizes) => Math.min(...sizes))

/**
 * Payload remembers per user whether the side navigation was left open, and other specs flip it:
 * open it until the menu can really be clicked.
 */
const showNav = async (page: Page) => {
  const pages = page.locator('#nav-menu-pages')
  await expect(async () => {
    const usable = await pages
      .click({ trial: true, timeout: 1_000 })
      .then(() => true)
      .catch(() => false)
    if (!usable)
      await page
        .getByRole('button', { name: /^(Open|Close) Menu$/ })
        .first()
        .click()
    await pages.click({ trial: true, timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
}

/** "Everything else" open or closed, as asked — Payload keeps the choice for the next visit. */
const setFold = async (page: Page, open: boolean) => {
  const fold = page.locator('#nav-everything-else')
  const isOpen = await fold.evaluate((el) => (el as HTMLDetailsElement).open)
  if (isOpen !== open) {
    // The preference is saved over REST; wait for THIS save (opening Payload's side menu saves to
    // the same `nav` key), so a reload sees it.
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().includes('/api/payload-preferences/nav') &&
        (r.request().postData() ?? '').includes(`"Everything else":{"open":${open}}`),
    )
    await fold.locator('summary').click()
    await saved
  }
  if (open) await expect(fold).toHaveAttribute('open', '')
  else await expect(fold).not.toHaveAttribute('open')
}

adminTest.describe('the district’s side navigation', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest('a short menu of actions, then everything else folded away', async ({ page }) => {
    await page.goto('/admin')
    await showNav(page)
    await expect(page.locator('#action-menu > li')).toHaveText([
      'Approvals',
      'Pages',
      'Announcements',
      'Events',
      'Alerts',
      'Users',
      'Files',
    ])
    await expect(page.locator('#nav-approvals')).toHaveAttribute('href', '/admin/approvals')
    // Files asks for the site first, as Pages does.
    await expect(page.locator('#nav-file-library')).toHaveAttribute('aria-controls', 'site-flyout')
    // Payload's own groups are drawn once, inside the fold, and nowhere else.
    await expect(page.locator('#nav-pages')).toHaveCount(1)
    await expect(page.locator('#nav-everything-else #nav-pages')).toHaveCount(1)

    await setFold(page, false)
    await expect(page.locator('#nav-pages')).toBeHidden()
    await setFold(page, true)
    await expect(page.locator('#nav-pages')).toBeVisible()

    // Remembered: still open on the next screen.
    await page.reload()
    await showNav(page)
    await expect(page.locator('#nav-pages')).toBeVisible()
    await setFold(page, false)
    await page.reload()
    await showNav(page)
    await expect(page.locator('#nav-pages')).toBeHidden()
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(
      `@a11y Pages → choose a site → its pages; add one in place — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const parent = await makePage(baseURL, { title: uniqueTitle('Families') })
        let created: number | null = null
        try {
          await page.goto('/admin')
          await showNav(page)
          expect(await smallestText(page, '#action-menu')).toBeGreaterThanOrEqual(15)

          // Pages slides out "Choose a site" beside the menu (Jason, 2026-11-18).
          const pagesButton = page.locator('#nav-menu-pages')
          await expect(pagesButton).toHaveAttribute('aria-expanded', 'false')
          await pagesButton.click()
          await expect(pagesButton).toHaveAttribute('aria-expanded', 'true')
          const panel = page.locator('#site-flyout')
          await expect(page.getByRole('region', { name: 'Choose a site' })).toBeVisible()
          await expect(panel.getByRole('heading', { name: 'Choose a site' })).toBeFocused()
          await expect(panel).toContainText('for Pages')
          // The district first, then the schools.
          await expect(panel.locator('li').first()).toHaveText('DD2 District')
          expect(await blockingViolations(page)).toEqual([])
          expect(await smallestText(page, '#site-flyout')).toBeGreaterThanOrEqual(15)
          // Escape shuts it and gives focus back; it opens again for the choice.
          await page.keyboard.press('Escape')
          await expect(panel).toBeHidden()
          await expect(pagesButton).toBeFocused()
          await pagesButton.click()

          // A site: its pages REPLACE the sites in the panel (Jason, 2026-11-18).
          const tenant = await tenantIdFor(parent.admin, SCHOOL_HOSTNAME)
          await panel.getByRole('button', { name: 'School A', exact: true }).click()
          await expect(panel.getByRole('heading', { name: 'Pages — School A' })).toBeFocused()
          await expect(page.getByRole('region', { name: 'Pages — School A' })).toBeVisible()
          await expect(panel.getByRole('button', { name: 'School B', exact: true })).toHaveCount(0)
          const inPanel = panel.getByRole('link', { name: new RegExp(`^${parent.title}`) })
          await expect(inPanel).toContainText('Not live yet', { timeout: 20_000 })
          expect(await blockingViolations(page)).toEqual([])
          expect(await smallestText(page, '#site-flyout')).toBeGreaterThanOrEqual(15)
          // Back a level, and in again.
          await panel.getByRole('button', { name: 'All sites' }).click()
          await expect(panel.getByRole('heading', { name: 'Choose a site' })).toBeFocused()
          await panel.getByRole('button', { name: 'School A', exact: true }).click()

          // A page opens its form, and the panel shuts.
          await panel.getByRole('link', { name: new RegExp(`^${parent.title}`) }).click()
          await expect(page).toHaveURL(new RegExp(`/admin/collections/pages/${parent.id}`), {
            timeout: 20_000,
          })
          await expect(panel).toBeHidden()

          // "Add or move pages": the site's page tree, where a page is added in place.
          await pagesButton.click()
          await panel.getByRole('button', { name: 'School A', exact: true }).click()
          await panel.getByRole('link', { name: 'Add or move pages' }).click()
          await expect(page).toHaveURL(new RegExp(`/admin/site-pages\\?site=${tenant}$`))
          await expect(
            page.getByRole('heading', { level: 1, name: 'Pages — School A' }),
          ).toBeVisible({ timeout: 20_000 })
          await expect(page.locator('#nav-menu-pages')).toHaveAttribute('aria-current', 'page')
          // Next streams the title in after the page; axe's document-title check needs it.
          await expect(page).toHaveTitle(/\S/)

          const row = page.locator('#site-pages li').filter({
            has: page.getByRole('link', { name: parent.title, exact: true }),
          })
          await expect(row.first()).toContainText('Not live yet')
          expect(await blockingViolations(page)).toEqual([])
          expect(await smallestText(page, '#site-pages')).toBeGreaterThanOrEqual(15)

          // Add a page under the fixture, in place.
          await page
            .getByRole('link', { name: `Add a page here, under ${parent.title}`, exact: true })
            .click()
          const title = page.getByLabel('What is this page called?')
          await expect(title).toBeFocused()
          expect(await blockingViolations(page)).toEqual([])
          const childTitle = uniqueTitle('Field trips')
          await title.fill(childTitle)
          await page.getByRole('button', { name: 'Create the page' }).click()
          await expect(page).toHaveURL(/\/admin\/collections\/pages\/\d+/, { timeout: 20_000 })
          created = Number(page.url().match(/pages\/(\d+)/)![1])

          const res = await parent.admin.get(`/api/pages/${created}?draft=true&depth=0`)
          const doc = (await res.json()) as { title: string; parent: number; tenant: number }
          expect(doc).toMatchObject({ title: childTitle, parent: parent.id, tenant })

          // And it is listed under its parent.
          await page.goto(`/admin/site-pages?site=${tenant}`)
          await expect(
            page
              .locator('#site-pages li')
              .filter({ has: page.getByRole('link', { name: parent.title, exact: true }) })
              .locator('ul')
              .getByRole('link', { name: childTitle, exact: true }),
          ).toBeVisible({ timeout: 20_000 })
        } finally {
          if (created !== null) await deletePage(parent.admin, created)
          await deletePage(parent.admin, parent.id)
          await parent.admin.dispose()
        }
      },
    )
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(`@a11y Files opens on every folder, by site — ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      const tenant = await tenantIdFor(page.request, SCHOOL_HOSTNAME)
      const name = uniqueTitle('Menus')
      const made = await page.request.post('/api/resource-folders?depth=0', {
        data: { tenant, name },
      })
      expect(made.ok(), await made.text()).toBe(true)
      const folderId = ((await made.json()) as { doc: { id: number } }).doc.id
      try {
        await page.goto('/admin')
        await showNav(page)
        const files = page.locator('#nav-file-library')
        await files.click()
        await expect(files).toHaveAttribute('aria-expanded', 'true')
        const panel = page.locator('#site-flyout')
        await expect(panel.getByRole('heading', { level: 2, name: 'Files' })).toBeFocused()
        // No site to click through first (Jason, 2026-11-18): the folders, under their sites.
        await expect(panel.getByRole('button', { name: 'School A', exact: true })).toHaveCount(0)
        await expect(
          panel
            .getByRole('region', { name: 'School A', exact: true })
            .getByRole('button', { name, exact: true }),
        ).toBeVisible({ timeout: 20_000 })
        expect(await blockingViolations(page)).toEqual([])
        expect(await smallestText(page, '#site-flyout')).toBeGreaterThanOrEqual(15)
        await page.keyboard.press('Escape')
        await expect(files).toBeFocused()
      } finally {
        await page.request.delete(`/api/resource-folders/${folderId}`)
      }
    })
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(
      `@a11y Announcements opens on every board, by site; a board, on its posts — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const title = uniqueTitle('Picture day')
        const post = await makePost(baseURL, { title })
        try {
          await page.goto('/admin')
          await showNav(page)
          const button = page.locator('#nav-menu-posts')
          await button.click()
          await expect(button).toHaveAttribute('aria-expanded', 'true')
          const panel = page.locator('#site-flyout')
          await expect(
            panel.getByRole('heading', { level: 2, name: 'Announcements' }),
          ).toBeFocused()
          // Every site's boards, the district first (Jason, 2026-11-18: "a drawer with all boards").
          await expect(panel.locator('h3').first()).toHaveText('DD2 District', {
            timeout: 20_000,
          })
          for (const site of ['School A', 'School B'])
            await expect(
              panel
                .getByRole('region', { name: site, exact: true })
                .getByRole('button', { name: 'News', exact: true }),
            ).toBeVisible()
          expect(await blockingViolations(page)).toEqual([])
          expect(await smallestText(page, '#site-flyout')).toBeGreaterThanOrEqual(15)

          // A board: its posts REPLACE the boards (Jason, 2026-11-18), the newest first.
          const news = panel
            .getByRole('region', { name: 'School A', exact: true })
            .getByRole('button', { name: 'News', exact: true })
          await news.click()
          await expect(panel.getByRole('heading', { level: 2, name: 'News' })).toBeFocused()
          await expect(panel).toContainText('School A')
          await expect(panel.locator('h3')).toHaveCount(0)
          const row = panel.getByRole('link', { name: new RegExp(`^${title}`) })
          await expect(row).toContainText('Not live yet', { timeout: 20_000 })
          await expect(panel.getByRole('link', { name: 'Create post' })).toHaveAttribute(
            'href',
            /\/admin\/collections\/posts\?board=\d+&new=1$/,
          )
          expect(await blockingViolations(page)).toEqual([])
          expect(await smallestText(page, '#site-flyout')).toBeGreaterThanOrEqual(15)
          // Back a level, and in again.
          await panel.getByRole('button', { name: 'All boards' }).click()
          await expect(
            panel.getByRole('heading', { level: 2, name: 'Announcements' }),
          ).toBeFocused()
          await news.click()

          // A post opens its form, and the panel shuts.
          await panel.getByRole('link', { name: new RegExp(`^${title}`) }).click()
          await expect(page).toHaveURL(new RegExp(`/admin/collections/posts/${post.id}`), {
            timeout: 20_000,
          })
          await expect(panel).toBeHidden()
          await expect(button).toHaveAttribute('aria-current', 'page')
        } finally {
          await dropPost(post)
        }
      },
    )
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest(
      `@a11y Events opens on every calendar, by site — ${colorScheme}`,
      async ({ page }) => {
        await page.emulateMedia({ colorScheme })
        await page.goto('/admin')
        await showNav(page)
        const button = page.locator('#nav-menu-events')
        await button.click()
        await expect(button).toHaveAttribute('aria-expanded', 'true')
        const panel = page.locator('#site-flyout')
        await expect(panel.getByRole('heading', { level: 2, name: 'Events' })).toBeFocused()
        // Every site's calendars, the district first (Jason, 2026-11-18: "all calendars too").
        await expect(panel.locator('h3').first()).toHaveText('DD2 District', { timeout: 20_000 })
        await expect(panel.getByRole('link', { name: 'Add an event' })).toHaveAttribute(
          'href',
          '/admin/collections/events/create',
        )
        // Each site's main calendar is named after it.
        const main = panel
          .getByRole('region', { name: 'School B', exact: true })
          .getByRole('link', { name: /^School B Main calendar$/ })
        await expect(main).toBeVisible()
        expect(await blockingViolations(page)).toEqual([])
        expect(await smallestText(page, '#site-flyout')).toBeGreaterThanOrEqual(15)
        await main.click()
        await expect(page).toHaveURL(
          /\/admin\/collections\/events\?where%5Bcalendar%5D%5Bequals%5D=\d+/,
          {
            timeout: 20_000,
          },
        )
        await expect(panel).toBeHidden()
        await expect(button).toHaveAttribute('aria-current', 'page')
      },
    )
  }

  adminTest('with no site chosen, it asks for one', async ({ page }) => {
    await page.goto('/admin/site-pages')
    await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible({
      timeout: 20_000,
    })
    await page.locator('#site-pages-change').click()
    const panel = page.locator('#site-flyout')
    await expect(panel).toContainText('for Pages')
    // A click outside shuts it.
    await page.locator('#site-pages h1').click()
    await expect(panel).toBeHidden()
  })
})

schoolTest.describe('a school manager’s side navigation — the same workflow', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('their menu, then everything else folded away', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.locator('#nav-school')).toBeAttached({ timeout: 20_000 })
    await showNav(page)
    // The district's, less what is the district's (Jason, 2026-11-18).
    await expect(page.locator('#action-menu > li')).toHaveText([
      'Pages',
      'Announcements',
      'Events',
      'Files',
    ])
    await expect(page.locator('#nav-approvals')).toHaveCount(0)
    await expect(page.locator('#nav-everything-else #nav-pages')).toHaveCount(1)
    expect(await smallestText(page, '#action-menu')).toBeGreaterThanOrEqual(15)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    schoolTest(
      `@a11y Pages opens straight on their school’s pages; Announcements and Events on theirs — ${colorScheme}`,
      async ({ page }) => {
        await page.emulateMedia({ colorScheme })
        await page.goto('/admin')
        await showNav(page)
        const panel = page.locator('#site-flyout')

        // One school: no site to choose.
        await page.locator('#nav-menu-pages').click()
        await expect(panel.getByRole('heading', { name: 'Pages — School A' })).toBeFocused()
        await expect(panel.getByRole('button', { name: 'All sites' })).toHaveCount(0)
        await expect(panel.locator('li a').first()).toBeVisible({ timeout: 20_000 })
        // Where a page sits is the district's: "Add a page" is the new-page task.
        await expect(panel.getByRole('link', { name: 'Add a page' })).toHaveAttribute(
          'href',
          '/admin/new-page',
        )
        expect(await blockingViolations(page)).toEqual([])
        expect(await smallestText(page, '#site-flyout')).toBeGreaterThanOrEqual(15)
        await page.keyboard.press('Escape')

        // Their boards, and only theirs.
        await page.locator('#nav-menu-posts').click()
        await expect(panel.getByRole('heading', { level: 2, name: 'Announcements' })).toBeFocused()
        const news = panel
          .getByRole('region', { name: 'School A', exact: true })
          .getByRole('button', { name: 'News', exact: true })
        await expect(news).toBeVisible({ timeout: 20_000 })
        await expect(panel.getByRole('region', { name: 'School B', exact: true })).toHaveCount(0)
        expect(await blockingViolations(page)).toEqual([])
        // A board: its posts in the panel; the announcements screen a link away.
        await news.click()
        await expect(panel.getByRole('heading', { level: 2, name: 'News' })).toBeFocused()
        await expect(panel.getByRole('link', { name: 'Create post' })).toBeVisible({
          timeout: 20_000,
        })
        expect(await blockingViolations(page)).toEqual([])
        await panel.getByRole('link', { name: /on the announcements screen$/ }).click()
        await expect(page).toHaveURL(/\/admin\/collections\/posts\?board=\d+(&|$)/, {
          timeout: 20_000,
        })
        await expect(panel).toBeHidden()

        // Their calendars, and only theirs; "Add an event" is their task screen.
        await showNav(page)
        await page.locator('#nav-menu-events').click()
        await expect(panel.getByRole('heading', { level: 2, name: 'Events' })).toBeFocused()
        await expect(
          panel
            .getByRole('region', { name: 'School A', exact: true })
            .getByRole('link', { name: /^School A Main calendar$/ }),
        ).toBeVisible({ timeout: 20_000 })
        await expect(panel.getByRole('region', { name: 'School B', exact: true })).toHaveCount(0)
        await expect(panel.getByRole('link', { name: 'Add an event' })).toHaveAttribute(
          'href',
          '/admin/new-event',
        )
        expect(await blockingViolations(page)).toEqual([])
      },
    )
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    schoolTest(
      `@a11y an imported calendar, chosen, says it is a feed; never offered to add to — ${colorScheme}`,
      async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme })
        const admin = await playwrightRequest.newContext({
          ...(baseURL ? { baseURL } : {}),
          storageState: ADMIN_STORAGE_STATE,
        })
        const tenant = await tenantIdFor(admin, SCHOOL_HOSTNAME)
        const name = uniqueTitle('Athletics')
        const made = await admin.post('/api/calendars?depth=0', {
          data: {
            tenant,
            name,
            source: 'feed',
            feedUrl: 'https://calendar.google.com/calendar/ical/e2e/public/basic.ics',
          },
        })
        expect(made.ok(), await made.text()).toBe(true)
        const calendar = ((await made.json()) as { doc: { id: number } }).doc.id
        const NOTE =
          'This calendar is a feed from Google Calendar. Its events are added there, not here.'
        try {
          // In the panel: listed, with no note there (Jason, 2026-11-18) — chosen, a dialog says so.
          await page.goto('/admin')
          await showNav(page)
          await page.locator('#nav-menu-events').click()
          const panel = page.locator('#site-flyout')
          const choice = panel.getByRole('button', { name, exact: true })
          await expect(choice).toBeVisible({ timeout: 20_000 })
          await expect(panel).not.toContainText(NOTE)
          await choice.click()
          const dialog = page.getByRole('dialog', { name })
          await expect(dialog).toContainText(NOTE)
          await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
          expect(await blockingViolations(page)).toEqual([])
          // Escape closes the dialog only; focus goes back to the calendar, the panel stays.
          await page.keyboard.press('Escape')
          await expect(dialog).toBeHidden()
          await expect(choice).toBeFocused()
          await expect(panel).toBeVisible()
          // Its events are a link away.
          await choice.click()
          await dialog.getByRole('link', { name: 'See its events' }).click()
          await expect(page).toHaveURL(
            new RegExp(`/admin/collections/events\\?where%5Bcalendar%5D%5Bequals%5D=${calendar}`),
            { timeout: 20_000 },
          )
          await expect(panel).toBeHidden()

          // On "Add an event": named with the same line, and not a choice.
          await page.goto('/admin/new-event')
          await expect(page.getByRole('heading', { level: 1, name: 'Add an event' })).toBeVisible({
            timeout: 20_000,
          })
          await expect(page.locator('#new-event')).toContainText(`${name}: ${NOTE}`)
          await expect(page.getByRole('radio', { name })).toHaveCount(0)
          expect(await blockingViolations(page)).toEqual([])
        } finally {
          await admin.delete(`/api/calendars/${calendar}`)
          await admin.dispose()
        }
      },
    )
  }

  schoolTest('a site’s pages is the district’s: sent home', async ({ page }) => {
    await page.goto('/admin/site-pages')
    await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 20_000 })
  })
})
