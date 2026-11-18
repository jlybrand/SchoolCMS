import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { tinyPdf } from '../helpers/files'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * Site search on the public site (Jason, 2026-11-16; Phase 6 D): the header's box on every page,
 * the results page, this site or every site, a document result. The rules — scope, exclusions,
 * ranking — are `tests/integration/search.test.ts`; the components' own axe, LTR and RTL, is the
 * Storybook gate.
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

type Fixture = { admin: APIRequestContext; pages: number[]; files: number[]; word: string }

const publishPage = async (admin: APIRequestContext, host: string, title: string, text: string) => {
  const tenant = await tenantIdFor(admin, host)
  const res = await admin.post('/api/pages?depth=0', {
    data: {
      tenant,
      title,
      slug: `search-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      visibility: 'public',
      layout: [
        {
          blockType: 'richText',
          content: {
            root: {
              type: 'root',
              version: 1,
              direction: null,
              format: '',
              indent: 0,
              children: [
                {
                  type: 'paragraph',
                  version: 1,
                  children: [{ type: 'text', text, version: 1 }],
                },
              ],
            },
          },
        },
      ],
      _status: 'published',
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()).doc as { id: number }).id
}

const setUp = async (baseURL: string | undefined): Promise<Fixture> => {
  const admin = await playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })
  // A made-up word, so the results are only what this test made.
  const word = `zq${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
  const pages = [
    await publishPage(
      admin,
      'b.localhost',
      `Enrollment ${word}`,
      `Bring a birth certificate. ${word}`,
    ),
    await publishPage(admin, 'a.localhost', 'School A’s page', `Also mentions ${word}.`),
  ]
  const pdf = tinyPdf()
  const uploaded = await admin.post('/api/resources?depth=0', {
    multipart: {
      file: { name: pdf.name, mimeType: pdf.mimetype, buffer: pdf.data },
      _payload: JSON.stringify({
        tenant: await tenantIdFor(admin, 'b.localhost'),
        title: 'Bus request form',
        description: `Return it to the office. ${word}`,
        remediationStatus: 'attested',
      }),
    },
  })
  expect(uploaded.ok(), await uploaded.text()).toBe(true)
  return { admin, pages, files: [((await uploaded.json()).doc as { id: number }).id], word }
}

const tearDown = async ({ admin, pages, files }: Fixture) => {
  for (const id of pages) await admin.delete(`/api/pages/${id}`)
  for (const id of files) await admin.delete(`/api/resources/${id}`)
  await admin.dispose()
}

test.describe('site search', () => {
  test.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@a11y from the header box to the results, then across every site — ${colorScheme}`, async ({
      page,
      baseURL,
    }) => {
      await page.emulateMedia({ colorScheme })
      const fixture = await setUp(baseURL)
      try {
        // Any page: the header holds a named search landmark.
        await page.goto(siteUrl(baseURL, 'b.localhost', '/'))
        const box = page.getByRole('search', { name: 'Site search' })
        await box.getByRole('searchbox', { name: 'Search this site' }).fill(fixture.word)
        await box.getByRole('button', { name: 'Search' }).click()
        await expect(page).toHaveURL(new RegExp(`/search\\?q=${fixture.word}$`))

        // This site only: its page and its document, not School A's page.
        await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible()
        await expect(
          page.getByText(`2 results for “${fixture.word}” on School B Elementary.`),
        ).toBeVisible()
        const results = page
          .getByRole('list')
          .filter({ has: page.getByRole('heading', { level: 2 }) })
        await expect(
          results.getByRole('heading', { level: 2, name: `Enrollment ${fixture.word}` }),
        ).toBeVisible()
        const doc = results.getByRole('listitem').filter({ hasText: 'Bus request form' })
        await expect(doc).toContainText(/Document · PDF, \d+ KB/)
        await expect(doc.getByRole('link', { name: 'Bus request form' })).toHaveAttribute(
          'href',
          /^\/api\/resources\/file\//,
        )
        await expect(results.getByText('School A’s page')).toHaveCount(0)
        // The matched word is marked.
        await expect(results.locator('mark').first()).toHaveText(new RegExp(fixture.word, 'i'))
        expect(await blockingViolations(page)).toEqual([])

        // Every site: School A's page too, labelled with its site.
        await page.getByRole('link', { name: 'Search all DD2 sites' }).click()
        await expect(page).toHaveURL(/scope=all/)
        await expect(
          page.getByText(`3 results for “${fixture.word}” across all DD2 sites.`),
        ).toBeVisible()
        const theirs = page.getByRole('listitem').filter({ hasText: 'School A’s page' })
        await expect(theirs).toContainText('Page · School A')
        await expect(
          page.getByRole('link', { name: 'Search only School B Elementary' }),
        ).toBeVisible()
        expect(await blockingViolations(page)).toEqual([])
      } finally {
        await tearDown(fixture)
      }
    })
  }

  test('@a11y nothing found says so, and offers every site; no words, a hint', async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${siteUrl(baseURL, 'b.localhost', '/search')}?q=zzzznothingmatchesthis`)
    await expect(
      page.getByText('No results for “zzzznothingmatchesthis” on School B Elementary.'),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Search all DD2 sites' })).toBeVisible()
    expect(await blockingViolations(page)).toEqual([])

    await page.goto(siteUrl(baseURL, 'b.localhost', '/search'))
    await expect(page.getByText(/Type a word or two/)).toBeVisible()
    // The page's own form is labelled; the header's is named apart from it.
    await expect(page.getByRole('search', { name: 'Search again' })).toBeVisible()
    await expect(page.getByRole('search', { name: 'Site search' })).toBeVisible()
  })

  /*
   * The Arabic results page (`@rtl`) is retired while every site is English only (Jason,
   * 2026-11-18): `/ar/search` is a 404. RTL stays guarded by the component axe gate (every story,
   * LTR and RTL) and the logical-properties lint; bring this back when a language is served.
   */
})
