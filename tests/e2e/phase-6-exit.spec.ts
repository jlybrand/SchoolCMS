import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { schoolRequest } from './support/fixture-pages'
import { tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * The Phase 6 exit check (`05`), over real HTTP — the two clauses this phase owns:
 *
 * 1. "An image cannot be uploaded without alt or a decorative flag" — through the REST API, as the
 *    district and as a school (CLAUDE.md rule 7: "the API path cannot bypass it"). The rule itself
 *    is `tests/integration/resources.test.ts`; the district's Files form is `resources.spec.ts`;
 *    the school's task is `school-upload.spec.ts`.
 * 2. "Search returns scoped, accessible results" — one journey: a school publishes, and its page is
 *    findable from its own site's search, not from another school's, and from every-site search,
 *    with axe on each results page. Timed: `publish-to-findable`.
 *
 * The close-out maps every clause to its proof: `docs/phases/06` §10.
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

/** A real 2×2 PNG — Payload checks what it is given. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNkYGD4z8DAwMDAwMAAAAgPAQBJpJ4YAAAAAElFTkSuQmCC',
  'base64',
)

const upload = (request: APIRequestContext, data: Record<string, unknown>) =>
  request.post('/api/resources?depth=0', {
    multipart: {
      file: { name: `exit-${Date.now()}-${Math.random()}.png`, mimeType: 'image/png', buffer: PNG },
      _payload: JSON.stringify(data),
    },
  })

test.describe('exit clause 1 — no image without alt text or "decorative"', () => {
  test.skip(credentials === null, SKIP)

  test('the REST API refuses it, for the district and for a school; alt or decorative passes', async ({
    baseURL,
  }) => {
    const district = await playwrightRequest.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: ADMIN_STORAGE_STATE,
    })
    const school = await schoolRequest(baseURL)
    const made: number[] = []
    try {
      const tenant = await tenantIdFor(district, 'a.localhost')
      for (const [who, request] of [
        ['district', district],
        ['school', school],
      ] as const) {
        const refused = await upload(request, { tenant, title: `No alt (${who})` })
        expect(refused.status(), `${who}: no alt must be refused`).toBe(400)
        expect(await refused.text()).toContain('Describe the image')
        // Blank alt is no alt.
        const blank = await upload(request, { tenant, title: `Blank alt (${who})`, alt: '   ' })
        expect(blank.status(), `${who}: blank alt must be refused`).toBe(400)

        for (const data of [{ alt: 'Students in the gym' }, { isDecorative: true }]) {
          const ok = await upload(request, { tenant, title: `Accepted (${who})`, ...data })
          expect(ok.ok(), await ok.text()).toBe(true)
          made.push(((await ok.json()).doc as { id: number }).id)
        }
      }
    } finally {
      for (const id of made) await district.delete(`/api/resources/${id}`)
      await district.dispose()
      await school.dispose()
    }
  })
})

test.describe('exit clause 3 — search returns scoped, accessible results', () => {
  test.skip(credentials === null, SKIP)

  test('@a11y a school publishes; its own search finds it, another school’s does not, every-site does', async ({
    page,
    baseURL,
  }, testInfo) => {
    const admin = await playwrightRequest.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: ADMIN_STORAGE_STATE,
    })
    const word = `zqexit${Date.now().toString(36)}`
    const tenant = await tenantIdFor(admin, 'b.localhost')
    let pageId = 0
    try {
      const published = Date.now()
      const made = await admin.post('/api/pages?depth=0', {
        data: {
          tenant,
          title: `Exit check ${word}`,
          slug: `exit-${word}`,
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
                      children: [{ type: 'text', text: `Findable by ${word}.`, version: 1 }],
                    },
                  ],
                },
              },
            },
          ],
          _status: 'published',
        },
      })
      expect(made.ok(), await made.text()).toBe(true)
      pageId = ((await made.json()).doc as { id: number }).id

      // Its own site: found, and timed.
      const own = `${siteUrl(baseURL, 'b.localhost', '/search')}?q=${word}`
      await expect(async () => {
        await page.goto(own)
        await expect(
          page.getByRole('heading', { level: 2, name: `Exit check ${word}` }),
        ).toBeVisible({
          timeout: 1_000,
        })
      }).toPass({ timeout: 30_000 })
      const ms = Date.now() - published
      testInfo.annotations.push({ type: 'publish-to-findable', description: `${ms} ms` })
      await expect(
        page.getByRole('heading', { level: 2, name: `Exit check ${word}` }).getByRole('link'),
      ).toHaveAttribute('href', `/exit-${word}`)
      expect(await blockingViolations(page)).toEqual([])

      // Another school's search: not there.
      await page.goto(`${siteUrl(baseURL, 'a.localhost', '/search')}?q=${word}`)
      await expect(page.getByText(`No results for “${word}”`)).toBeVisible()
      expect(await blockingViolations(page)).toEqual([])

      // Every site, from that other school: there, labelled with its site.
      await page.getByRole('link', { name: 'Search all DD2 sites' }).click()
      const result = page.getByRole('listitem').filter({ hasText: `Exit check ${word}` })
      await expect(result).toContainText('Page · School B Elementary')
      await expect(result.getByRole('link')).toHaveAttribute('href', /b\.localhost.*\/exit-/)
      expect(await blockingViolations(page)).toEqual([])
    } finally {
      if (pageId) await admin.delete(`/api/pages/${pageId}`)
      await admin.dispose()
    }
  })
})
