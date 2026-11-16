import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { dropPage, makePage, type FixturePage } from './support/fixture-pages'
import { dropPost, makePost, type FixturePost } from './support/fixture-posts'
import { followLink } from './support/follow-link'
import { schoolTest } from './support/school-session'

/**
 * WHOLE-SCREEN axe over both admin planes (`04` §6, §9.6; CLAUDE.md rule 6).
 *
 * The other admin specs audit the part they own (a field, the queue, a panel). This audits each
 * screen a role works in, Payload's own chrome included, because that is what the person using
 * it meets.
 *
 * Several screens pass only because `src/admin/A11yPatch/` repairs Payload's own markup
 * (`docs/phases/04` §17–§18). Those screens wait for a REPAIRED attribute before auditing — the
 * patch runs after Payload renders — and that wait is also what fails, loudly, if a Payload bump
 * renames what a repair looks for.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'
const BLOCKING_IMPACTS = ['critical', 'serious']

/** Every selector must match before the audit — the screen is rendered AND repaired. */
const auditScreen = async (page: Page, ...ready: string[]) => {
  for (const selector of ready) {
    await expect(page.locator(selector).first()).toBeAttached({ timeout: 20_000 })
  }
  /**
   * SETTLED, not just ready. Payload re-renders a list after hydration (rows briefly disabled
   * while it refetches), and the patch repairs the new nodes on the next animation frame — an
   * audit in between sees the unrepaired rows. So: no list checkbox left with Payload's empty
   * name, then two frames for the patch's last pass.
   */
  await expect(page.locator('tbody input[type="checkbox"][aria-label=""]')).toHaveCount(0, {
    timeout: 10_000,
  })
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ''))
  expect(
    blocking,
    `Blocking a11y violations on ${page.url()}:\n${blocking
      .map(
        (v) =>
          `  [${v.impact}] ${v.id}: ${v.help}\n` +
          v.nodes
            .map((n) => `      ${n.target.join(' ')}\n      ${n.html.slice(0, 200)}`)
            .join('\n'),
      )
      .join('\n')}`,
  ).toEqual([])
}

/** The page form, once rendered and repaired: the "⋯" button and the editor are named. */
const PAGE_FORM_REPAIRED = [
  '#field-title',
  '.doc-controls .popup-button[aria-label="More actions"]',
  '.ContentEditable__root[aria-label]',
  'button.toolbar-popup__button-bold[aria-label="Bold"]',
]

/** A document's tabs (API, …), once repaired: no longer a list of non-items. */
const TABS_REPAIRED = ['ul.doc-tabs__tabs[role="none"]']

/** A list view, once repaired: the first row's checkbox is named. */
const LIST_REPAIRED = ['tbody .select-row input[aria-label^="Select "]']

let fixture: FixturePage
let post: FixturePost
let feedPage: number
let columnsPage: number
let linksPage: number
let event: number
/** A calendar copied from an outside address (Jason, 2026-11-11). */
let feedCalendar: number
let staffGroup: number
let staffPage: number
let imageFile: number
let picturesPage: number
let person: number
/** School A's own event, for the school plane's screens. */
let schoolEvent: number

/** The post form, once rendered and repaired — the page form's controls, less the page's own. */
const POST_FORM_REPAIRED = PAGE_FORM_REPAIRED

schoolTest.describe('school plane — whole screens', () => {
  schoolTest.skip(credentials === null, SKIP)
  schoolTest.beforeAll(async ({ baseURL }) => {
    fixture = await makePage(baseURL, { title: 'Axe page' })
    post = await makePost(baseURL)
    const made = await fixture.admin.post('/api/events?draft=true&depth=0', {
      data: {
        tenant: (await (await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)).json()).tenant,
        title: 'Axe school event',
        start: '2030-12-04T23:30:00.000Z',
        _status: 'draft',
      },
    })
    expect(made.ok(), await made.text()).toBe(true)
    schoolEvent = ((await made.json()).doc as { id: number }).id
  })
  schoolTest.afterAll(async () => {
    await fixture.admin.delete(`/api/events/${schoolEvent}`)
    await dropPage(fixture)
    await dropPost(post)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    schoolTest.describe(colorScheme, () => {
      schoolTest.use({ colorScheme })

      schoolTest(`@a11y home — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin')
        await auditScreen(page, 'h1')
      })
      schoolTest(`@a11y update a page — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/update-page')
        await auditScreen(page, 'h1')
      })
      schoolTest(`@a11y add a page — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/new-page')
        await auditScreen(page, '#new-page')
      })
      schoolTest(`@a11y post an announcement — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/new-post')
        await auditScreen(page, '#new-post')
      })
      schoolTest(`@a11y pages list, with its task button — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/pages')
        await auditScreen(page, '#list-task', ...LIST_REPAIRED)
      })
      schoolTest(`@a11y news and announcements list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/posts')
        await auditScreen(page, '#announcements #create-post')
      })
      schoolTest(`@a11y add an event — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/new-event')
        await auditScreen(page, '#new-event')
      })
      schoolTest(`@a11y events list, with its task button — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/events')
        await auditScreen(page, '#list-task', ...LIST_REPAIRED)
      })
      schoolTest(`@a11y the event form — ${colorScheme}`, async ({ page }) => {
        await page.goto(`/admin/collections/events/${schoolEvent}`)
        await auditScreen(
          page,
          '#action-save',
          '#field-title',
          '#field-calendar input[aria-label="Calendar"]',
          '#field-start .date-time-picker__clear-button[aria-label="Clear Starts"]',
        )
      })
      schoolTest(`@a11y their account — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/account')
        await auditScreen(page, '#your-school')
      })
      schoolTest(`@a11y the page form — ${colorScheme}`, async ({ page }) => {
        await page.goto(`/admin/collections/pages/${fixture.id}`)
        await auditScreen(page, '#action-send-for-approval', ...PAGE_FORM_REPAIRED)
      })
      schoolTest(`@a11y the post form — ${colorScheme}`, async ({ page }) => {
        await page.goto(`/admin/collections/posts/${post.id}`)
        await auditScreen(page, '#action-send-for-approval', ...POST_FORM_REPAIRED)
      })
    })
  }
})

adminTest.describe('district plane — whole screens', () => {
  adminTest.skip(credentials === null, SKIP)
  adminTest.beforeAll(async ({ baseURL }) => {
    fixture = await makePage(baseURL, { title: 'Axe page' })
    // A publish writes an activity entry, so the log has a row to audit.
    const published = await fixture.admin.patch(`/api/pages/${fixture.id}?depth=0`, {
      data: { _status: 'published' },
    })
    expect(published.ok(), 'publish the fixture').toBe(true)
    // Shared with chosen sites, so the form shows that field and its chosen site.
    post = await makePost(baseURL, { selected: true, tagged: true })
    // A composed page carrying a news feed, with a board and a tag chosen.
    const boards = await fixture.admin.get('/api/post-boards?limit=1&depth=0')
    const tags = await fixture.admin.get('/api/post-tags?limit=1&depth=0')
    const made = await fixture.admin.post('/api/pages?draft=true&depth=0', {
      data: {
        tenant: (await (await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)).json()).tenant,
        title: 'Axe feed page',
        slug: `axe-feed-${Date.now()}`,
        layout: [
          {
            blockType: 'feed',
            heading: 'District news',
            boards: [((await boards.json()).docs as { id: number }[])[0]!.id],
            tags: [((await tags.json()).docs as { id: number }[])[0]!.id],
          },
        ],
        _status: 'draft',
      },
    })
    expect(made.ok(), await made.text()).toBe(true)
    feedPage = ((await made.json()).doc as { id: number }).id
    /** Columns holding other blocks (Jason, 2026-11-04): Payload's nested block rows on screen. */
    const cols = await fixture.admin.post('/api/pages?draft=true&depth=0', {
      data: {
        tenant: (await (await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)).json()).tenant,
        title: 'Axe columns page',
        slug: `axe-columns-${Date.now()}`,
        layout: [
          {
            blockType: 'columns',
            heading: 'Ways to help',
            columns: [
              { heading: 'Volunteer', content: [{ blockType: 'divider' }] },
              { heading: 'PTA', content: [{ blockType: 'childPageNav' }] },
            ],
          },
        ],
        _status: 'draft',
      },
    })
    expect(cols.ok(), await cols.text()).toBe(true)
    columnsPage = ((await cols.json()).doc as { id: number }).id
    /**
     * A composed page whose button and first card link to a PAGE and second card to an address
     * (Jason, 2026-10-29), so the page picker inside a block row is on screen with a page
     * chosen. Menus use the same fields (`src/collections/fields/link.ts`).
     */
    const linked = await fixture.admin.post('/api/pages?draft=true&depth=0', {
      data: {
        tenant: (await (await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)).json()).tenant,
        title: 'Axe links page',
        slug: `axe-links-${Date.now()}`,
        layout: [
          {
            blockType: 'callToAction',
            heading: 'Enroll',
            linkLabel: 'Start enrollment',
            linkType: 'page',
            page: fixture.id,
          },
          {
            blockType: 'cardGrid',
            cards: [
              { title: 'A page', linkType: 'page', page: fixture.id },
              { title: 'An address', linkType: 'address', href: '/athletics' },
            ],
          },
        ],
        _status: 'draft',
      },
    })
    expect(linked.ok(), await linked.text()).toBe(true)
    linksPage = ((await linked.json()).doc as { id: number }).id
    /** An event that repeats, so "Repeats until" is on screen, on its site's own calendar. */
    const madeEvent = await fixture.admin.post('/api/events?draft=true&depth=0', {
      data: {
        tenant: (await (await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)).json()).tenant,
        title: 'Axe event',
        start: '2030-12-04T23:00:00.000Z',
        end: '2030-12-05T01:00:00.000Z',
        location: 'Auditorium',
        repeat: 'weekly',
        repeatUntil: '2031-01-29T12:00:00.000Z',
        _status: 'draft',
      },
    })
    expect(madeEvent.ok(), await madeEvent.text()).toBe(true)
    event = ((await madeEvent.json()).doc as { id: number }).id
    // `.invalid` never resolves: if the job runner copies it, the form shows the problem in words.
    const madeFeed = await fixture.admin.post('/api/calendars?depth=0', {
      data: {
        tenant: (await (await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)).json()).tenant,
        name: 'Axe feed calendar',
        source: 'feed',
        feedUrl: 'https://example.invalid/athletics.ics',
      },
    })
    expect(madeFeed.ok(), await madeFeed.text()).toBe(true)
    feedCalendar = ((await madeFeed.json()).doc as { id: number }).id
    // The staff directory (2026-11-13): the seed's mock school and one of its staff (staff come
    // from CSI, never the dashboard), and a sub-group the district makes in it.
    const schools = await fixture.admin.get(
      '/api/staff-groups?where[csiLocationId][equals]=MOCK-SHS&depth=0&limit=1',
    )
    const school = ((await schools.json()).docs as { id: number }[])[0]
    expect(school, 'the seed’s mock school — run `pnpm run seed`').toBeTruthy()
    const staff = await fixture.admin.get(
      `/api/people?where[group][equals]=${school!.id}&depth=0&limit=1&sort=sortKey`,
    )
    person = ((await staff.json()).docs as { id: number }[])[0]!.id
    const madeGroup = await fixture.admin.post('/api/staff-groups?depth=0', {
      data: { name: `Axe sub-group ${Date.now()}`, parent: school!.id, members: [person] },
    })
    expect(madeGroup.ok(), await madeGroup.text()).toBe(true)
    staffGroup = ((await madeGroup.json()).doc as { id: number }).id
    // A page holding a staff list (2026-11-13): its Group picker on screen.
    const madeStaffPage = await fixture.admin.post('/api/pages?draft=true&depth=0', {
      data: {
        tenant: (await (await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)).json()).tenant,
        title: 'Axe staff page',
        slug: `axe-staff-${Date.now()}`,
        layout: [{ blockType: 'staffList', heading: 'Our staff', group: school!.id }],
        _status: 'draft',
      },
    })
    expect(madeStaffPage.ok(), await madeStaffPage.text()).toBe(true)
    staffPage = ((await madeStaffPage.json()).doc as { id: number }).id
    // The file library (2026-11-13): an image, uploaded with its alt text.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNkYGD4z8DAwMDAwMAAAAgPAQBJpJ4YAAAAAElFTkSuQmCC',
      'base64',
    )
    const madeImage = await fixture.admin.post('/api/resources?depth=0', {
      multipart: {
        file: { name: `axe-${Date.now()}.png`, mimeType: 'image/png', buffer: png },
        _payload: JSON.stringify({
          tenant: (await (await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)).json())
            .tenant,
          title: 'Axe image',
          alt: 'A blue square',
        }),
      },
    })
    expect(madeImage.ok(), await madeImage.text()).toBe(true)
    imageFile = ((await madeImage.json()).doc as { id: number }).id
    // A page holding a hero and an image (2026-11-13): Payload's upload picker on screen.
    const madePictures = await fixture.admin.post('/api/pages?draft=true&depth=0', {
      data: {
        tenant: (await (await fixture.admin.get(`/api/pages/${fixture.id}?depth=0`)).json()).tenant,
        title: 'Axe pictures page',
        slug: `axe-pictures-${Date.now()}`,
        layout: [
          { blockType: 'hero', image: imageFile, heading: 'Welcome', linkType: 'none' },
          { blockType: 'image', image: imageFile, caption: 'A caption' },
        ],
        _status: 'draft',
      },
    })
    expect(madePictures.ok(), await madePictures.text()).toBe(true)
    picturesPage = ((await madePictures.json()).doc as { id: number }).id
  })
  adminTest.afterAll(async () => {
    await fixture.admin.delete(`/api/pages/${staffPage}`)
    await fixture.admin.delete(`/api/pages/${picturesPage}`)
    await fixture.admin.delete(`/api/resources/${imageFile}`)
    await fixture.admin.delete(`/api/staff-groups/${staffGroup}`)
    await fixture.admin.delete(`/api/calendars/${feedCalendar}`)
    await fixture.admin.delete(`/api/events/${event}`)
    await fixture.admin.delete(`/api/pages/${feedPage}`)
    await fixture.admin.delete(`/api/pages/${columnsPage}`)
    await fixture.admin.delete(`/api/pages/${linksPage}`)
    await dropPage(fixture)
    await dropPost(post)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    adminTest.describe(colorScheme, () => {
      adminTest.use({ colorScheme })

      adminTest(`@a11y activity log — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/audit-events')
        await auditScreen(page, ...LIST_REPAIRED)
      })
      adminTest(`@a11y an activity entry — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/audit-events')
        await followLink(page, page.locator('tbody tr a').first(), /\/audit-events\/[^/]+$/)
        await auditScreen(page, '#field-actorLabel')
      })

      adminTest(`@a11y approval queue — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/approvals')
        await auditScreen(page, 'h1')
      })
      adminTest(`@a11y dashboard — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin')
        await auditScreen(
          page,
          '#approvals-panel',
          '#freshness-panel',
          '#activity-panel',
          '#grants-panel',
          '#everything-else',
          '.dashboard-breadcrumb-select input[aria-label="Choose a view"]',
        )
      })
      adminTest(`@a11y pages list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/pages')
        await auditScreen(page, ...LIST_REPAIRED, '.clickable-arrow--right[aria-label="Next page"]')
      })
      adminTest(`@a11y users list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/users')
        await auditScreen(page, ...LIST_REPAIRED)
      })
      adminTest(`@a11y the page form — ${colorScheme}`, async ({ page }) => {
        await page.goto(`/admin/collections/pages/${fixture.id}`)
        await auditScreen(page, ...PAGE_FORM_REPAIRED, '#field-parent input[aria-label="Parent"]')
      })
      adminTest(`@a11y a page with a news feed — ${colorScheme}`, async ({ page }) => {
        await page.goto(`/admin/collections/pages/${feedPage}`)
        await auditScreen(
          page,
          '#field-title',
          '#field-layout__0__boards input[aria-label="Boards"]',
          '#field-layout__0__tags input[aria-label="Only these tags"]',
          '#field-layout__0__limit',
          // The block row's controls, named by the patch.
          '.collapsible__drag[aria-label="Reorder"]',
          '.array-actions__button[aria-label="Row actions"]',
          '.clipboard-action__popup .popup-button[aria-label="Copy or paste"]',
        )
      })
      adminTest(`@a11y a page with a staff list — ${colorScheme}`, async ({ page }) => {
        await page.goto(`/admin/collections/pages/${staffPage}`)
        await auditScreen(
          page,
          '#field-title',
          '#field-layout__0__heading',
          '#field-layout__0__group input[aria-label="Group"]',
          '.collapsible__drag[aria-label="Reorder"]',
          '.array-actions__button[aria-label="Row actions"]',
        )
      })
      adminTest(`@a11y a page with columns holding blocks — ${colorScheme}`, async ({ page }) => {
        await page.goto(`/admin/collections/pages/${columnsPage}`)
        await auditScreen(
          page,
          '#field-title',
          '#field-layout__0__heading',
          '#field-layout__0__columns__1__heading',
          '.collapsible__drag[aria-label="Reorder"]',
          '.array-actions__button[aria-label="Row actions"]',
        )
      })
      adminTest(
        `@a11y a page with buttons and cards linking to pages — ${colorScheme}`,
        async ({ page }) => {
          await page.goto(`/admin/collections/pages/${linksPage}`)
          /**
           * A saved block's nested rows open collapsed; open the cards so theirs are audited.
           * Retried: Payload keeps which rows are open in the USER's preferences, and the other
           * theme's run, as the same user on the same page, can close them again mid-way.
           */
          await expect(async () => {
            // The layout's own "Show All" too, when the other run has collapsed the blocks.
            for (const showAll of await page.getByRole('button', { name: 'Show All' }).all()) {
              await showAll.click()
            }
            await expect(page.locator('#field-layout__1__cards__1__href')).toBeAttached({
              timeout: 2_000,
            })
          }).toPass({ timeout: 20_000 })
          await auditScreen(
            page,
            '#field-title',
            '#field-layout__0__page input[aria-label="Page"]',
            '#field-layout__1__cards__0__page input[aria-label="Page"]',
            '#field-layout__1__cards__1__href',
            // Each chosen page's clear button, taken out of the tab order by the patch.
            '#field-layout__0__page .clear-indicator[aria-hidden="true"][tabindex="-1"]',
            '#field-layout__1__cards__0__page .clear-indicator[aria-hidden="true"][tabindex="-1"]',
            '.collapsible__drag[aria-label="Reorder"]',
          )
        },
      )
      adminTest(`@a11y announcement boards, folders open — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/post-boards')
        await expect(page.locator('#boards details').first()).toBeAttached({ timeout: 20_000 })
        // Every folder open, so every board link is audited.
        await page
          .locator('#boards details')
          .evaluateAll((all) => all.forEach((d) => d.setAttribute('open', '')))
        await auditScreen(page, '#boards h1', '#boards details[open] li a')
      })
      adminTest(`@a11y a board — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/post-boards')
        await page.locator('#boards summary').first().click()
        await page.locator('#boards details[open] li a').first().click()
        await auditScreen(
          page,
          '#field-name',
          '#field-folder input[aria-label="Folder"]',
          // The chosen folder's clear button, taken out of the tab order by the patch.
          '#field-folder .clear-indicator[aria-hidden="true"][tabindex="-1"]',
        )
      })
      adminTest(`@a11y post an announcement on a board — ${colorScheme}`, async ({ page }) => {
        const boards = await page.request.get('/api/post-boards?limit=1&depth=0')
        const [board] = (await boards.json()).docs as { id: number }[]
        await page.goto(`/admin/new-post?board=${board!.id}`)
        await auditScreen(page, '#board-heading', '#new-post form')
      })
      adminTest(`@a11y calendars list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/calendars')
        await auditScreen(page, ...LIST_REPAIRED)
      })
      adminTest(`@a11y a feed calendar’s form — ${colorScheme}`, async ({ page }) => {
        await page.goto(`/admin/collections/calendars/${feedCalendar}`)
        await auditScreen(page, '#field-name', '#field-source', '#field-feedUrl')
      })
      adminTest(`@a11y a page with a hero and an image — ${colorScheme}`, async ({ page }) => {
        await page.goto(`/admin/collections/pages/${picturesPage}`)
        await auditScreen(
          page,
          '#field-title',
          '#field-layout__0__heading',
          '#field-layout__1__caption',
          '.collapsible__drag[aria-label="Reorder"]',
          ...TABS_REPAIRED,
        )
      })
      adminTest(`@a11y files list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/resources')
        await auditScreen(page, ...LIST_REPAIRED)
      })
      adminTest(`@a11y an image's form — ${colorScheme}`, async ({ page }) => {
        await page.goto(`/admin/collections/resources/${imageFile}`)
        await auditScreen(page, '#field-title', '#field-alt', ...TABS_REPAIRED)
      })
      adminTest(`@a11y uploading a new file — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/resources/create')
        await auditScreen(page, '#field-title', 'input[type="file"]')
      })
      adminTest(`@a11y folders list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/resource-folders')
        await expect(page.locator('h1')).toBeVisible({ timeout: 20_000 })
        await auditScreen(page)
      })
      adminTest(`@a11y staff list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/people')
        await auditScreen(page, ...LIST_REPAIRED)
      })
      adminTest(`@a11y a staff member's form — ${colorScheme}`, async ({ page }) => {
        await page.goto(`/admin/collections/people/${person}`)
        await auditScreen(page, '#field-name', '#field-title', '#field-sortName', ...TABS_REPAIRED)
      })
      adminTest(
        `@a11y a sub-group's form, with its checklist — ${colorScheme}`,
        async ({ page }) => {
          await page.goto(`/admin/collections/staff-groups/${staffGroup}`)
          await auditScreen(
            page,
            '#field-name',
            '#staff-group-members input[type="checkbox"]',
            ...TABS_REPAIRED,
          )
        },
      )
      adminTest(`@a11y staff groups list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/staff-groups')
        await auditScreen(page, ...LIST_REPAIRED)
      })
      adminTest(`@a11y events list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/events')
        await auditScreen(page, ...LIST_REPAIRED)
      })
      adminTest(`@a11y the event form, repeating — ${colorScheme}`, async ({ page }) => {
        await page.goto(`/admin/collections/events/${event}`)
        await expect(page.locator('#field-title')).toBeAttached({ timeout: 20_000 })
        // Payload draws a field only once it scrolls into view; Notes is below the fold.
        await expect(async () => {
          await page.mouse.wheel(0, 2000)
          await expect(page.locator('[data-lexical-editor="true"]')).toBeAttached({
            timeout: 1_000,
          })
        }).toPass({ timeout: 20_000 })
        await auditScreen(
          page,
          '#field-title',
          '#field-calendar input[aria-label="Calendar"]',
          '#field-repeatUntil',
          '[data-lexical-editor="true"]',
          // The chosen calendar's clear button, taken out of the tab order by the patch.
          '#field-calendar .clear-indicator[aria-hidden="true"][tabindex="-1"]',
          // Each date's "×", named by the patch ("Clear Starts").
          '#field-start .date-time-picker__clear-button[aria-label="Clear Starts"]',
        )
      })
      adminTest(`@a11y announcement folders list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/post-folders')
        await auditScreen(page, ...LIST_REPAIRED)
      })
      adminTest(`@a11y announcement tags list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/post-tags')
        await auditScreen(page, ...LIST_REPAIRED)
      })
      adminTest(`@a11y news and announcements, a board open — ${colorScheme}`, async ({ page }) => {
        const stored = await page.request.get(`/api/posts/${post.id}?draft=true&depth=0`)
        const { board } = (await stored.json()) as { board: number }
        await page.goto(`/admin/collections/posts?board=${board}`)
        await auditScreen(
          page,
          '#announcements details[open] a[aria-current="page"]',
          '#announcements tbody tr',
        )
      })
      adminTest(
        `@a11y news and announcements, no board chosen — ${colorScheme}`,
        async ({ page }) => {
          await page.goto('/admin/collections/posts')
          await auditScreen(page, '#announcements #board-heading')
        },
      )
      adminTest(
        `@a11y the post form, shared with chosen sites — ${colorScheme}`,
        async ({ page }) => {
          await page.goto(`/admin/collections/posts/${post.id}`)
          // Payload renders a field only once it scrolls into view, and the dates (Jason,
          // 2026-11-04) put the sharing settings below the fold at this window size.
          await page.locator('#field-syndication').scrollIntoViewIfNeeded({ timeout: 20_000 })
          await auditScreen(
            page,
            ...POST_FORM_REPAIRED,
            '#field-syndication__syndicatedTo input[aria-label="Sites"]',
            // The chosen sites' clear button, taken out of the tab order by the patch.
            '#field-syndication__syndicatedTo .clear-indicator[aria-hidden="true"][tabindex="-1"]',
            '#field-board input[aria-label="Board"]',
            '#field-tags input[aria-label="Tags"]',
          )
        },
      )
    })
  }
})

/**
 * The sidebar, OPEN, on a wide screen — 1.4.3 Contrast (Minimum). Found 2026-11-10: Payload
 * shows the sidebar by default only at wide widths, so every audit above (at Playwright's
 * 1280px) ran with it closed and never saw its group labels ("Content", "Administration"),
 * drawn #9a9a9a on white at 2.81:1. A district admin on a desktop monitor sees them every day.
 */
const auditOpenSidebar = async (page: Page, colorScheme: 'light' | 'dark') => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.emulateMedia({ colorScheme })
  await page.goto('/admin')
  await expect(page.locator('.nav-group__label').first()).toBeVisible({ timeout: 20_000 })
  const results = await new AxeBuilder({ page })
    .include('.nav')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ''))
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.any[0]?.message).join(' | ')}`),
  ).toEqual([])
}

for (const colorScheme of ['light', 'dark'] as const) {
  adminTest(
    `@a11y the open sidebar on a wide screen, district — ${colorScheme}`,
    async ({ page }) => {
      adminTest.skip(credentials === null, SKIP)
      await auditOpenSidebar(page, colorScheme)
    },
  )
  schoolTest(
    `@a11y the open sidebar on a wide screen, school — ${colorScheme}`,
    async ({ page }) => {
      schoolTest.skip(credentials === null, SKIP)
      await auditOpenSidebar(page, colorScheme)
    },
  )
}
