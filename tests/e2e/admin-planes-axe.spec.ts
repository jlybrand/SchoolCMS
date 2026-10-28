import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { dropPage, makePage, type FixturePage } from './support/fixture-pages'
import { dropPost, makePost, type FixturePost } from './support/fixture-posts'
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

/** A list view, once repaired: the first row's checkbox is named. */
const LIST_REPAIRED = ['tbody .select-row input[aria-label^="Select "]']

let fixture: FixturePage
let post: FixturePost
let feedPage: number

/** The post form, once rendered and repaired — the page form's controls, less the page's own. */
const POST_FORM_REPAIRED = PAGE_FORM_REPAIRED

schoolTest.describe('school plane — whole screens', () => {
  schoolTest.skip(credentials === null, SKIP)
  schoolTest.beforeAll(async ({ baseURL }) => {
    fixture = await makePage(baseURL, { title: 'Axe page' })
    post = await makePost(baseURL)
  })
  schoolTest.afterAll(async () => {
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
        pageType: 'composed',
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
  })
  adminTest.afterAll(async () => {
    await fixture.admin.delete(`/api/pages/${feedPage}`)
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
        await page.locator('tbody tr a').first().click()
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
          '#waiting-banner',
          '#grants-panel',
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
      adminTest(`@a11y announcement folders list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/post-folders')
        await auditScreen(page, ...LIST_REPAIRED)
      })
      adminTest(`@a11y announcement tags list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/post-tags')
        await auditScreen(page, ...LIST_REPAIRED)
      })
      adminTest(`@a11y posts list — ${colorScheme}`, async ({ page }) => {
        await page.goto('/admin/collections/posts')
        await auditScreen(page, ...LIST_REPAIRED)
      })
      adminTest(
        `@a11y the post form, shared with chosen sites — ${colorScheme}`,
        async ({ page }) => {
          await page.goto(`/admin/collections/posts/${post.id}`)
          await auditScreen(
            page,
            ...POST_FORM_REPAIRED,
            '#field-syndication__syndicatedTo input[aria-label="Sites"]',
            '#field-board input[aria-label="Board"]',
            '#field-tags input[aria-label="Tags"]',
          )
        },
      )
    })
  }
})
