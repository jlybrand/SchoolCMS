import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * Columns on the public site (Jason, 2026-11-04): blocks nested in columns, side by side on a
 * wide screen and stacked — contents included — on a phone, with heading levels that follow
 * from where each block sits. The levels are `tests/unit/components/columns-levels.test.ts`;
 * every story's axe run is the component gate.
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

/** A published composed page on School A with one set of columns. */
const columnsPage = async (admin: APIRequestContext) => {
  const tenant = await tenantIdFor(admin, 'a.localhost')
  const slug = `columns-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const res = await admin.post('/api/pages?depth=0', {
    data: {
      tenant,
      title: uniqueTitle('Get involved'),
      slug,
      visibility: 'public',
      layout: [
        {
          blockType: 'columns',
          heading: 'Ways to help',
          columns: [
            {
              heading: 'Volunteer',
              content: [
                words('Help in classrooms and on field trips.'),
                {
                  blockType: 'callToAction',
                  heading: 'Sign up',
                  linkLabel: 'Volunteer sign-up',
                  linkType: 'address',
                  href: '/volunteer',
                },
              ],
            },
            { heading: 'PTA', content: [words('The PTA meets on the first Tuesday.')] },
          ],
        },
      ],
      _status: 'published',
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return { id: ((await res.json()).doc as { id: number }).id, slug }
}

test.describe('columns on a page', () => {
  test.skip(credentials === null, SKIP)

  let admin: APIRequestContext
  let made: { id: number; slug: string }

  test.beforeAll(async ({ baseURL }) => {
    admin = await playwrightRequest.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: ADMIN_STORAGE_STATE,
    })
    made = await columnsPage(admin)
  })

  test.afterAll(async () => {
    await admin.delete(`/api/pages/${made.id}`)
    await admin.dispose()
  })

  test('@smoke nests headings by where each sits: h2, h3 per column, h4 inside', async ({
    page,
    baseURL,
  }) => {
    await page.goto(siteUrl(baseURL, 'a.localhost', `/${made.slug}`))
    await expect(page.getByRole('heading', { level: 2, name: 'Ways to help' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByRole('heading', { level: 3, name: 'Volunteer' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: 'PTA' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 4, name: 'Sign up' })).toBeVisible()
  })

  test('sits side by side on a wide screen and stacks on a phone, contents included', async ({
    page,
    baseURL,
  }) => {
    const url = siteUrl(baseURL, 'a.localhost', `/${made.slug}`)
    const boxes = async () => {
      const volunteer = await page
        .getByRole('heading', { level: 3, name: 'Volunteer' })
        .boundingBox()
      const pta = await page.getByRole('heading', { level: 3, name: 'PTA' }).boundingBox()
      const signUp = await page.getByRole('link', { name: 'Volunteer sign-up' }).boundingBox()
      return { volunteer: volunteer!, pta: pta!, signUp: signUp! }
    }

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 3, name: 'PTA' })).toBeVisible({
      timeout: 20_000,
    })
    const wide = await boxes()
    expect(Math.abs(wide.volunteer.y - wide.pta.y)).toBeLessThan(2)
    expect(wide.pta.x).toBeGreaterThan(wide.volunteer.x)

    await page.setViewportSize({ width: 375, height: 800 })
    await page.reload()
    await expect(page.getByRole('heading', { level: 3, name: 'PTA' })).toBeVisible({
      timeout: 20_000,
    })
    const narrow = await boxes()
    // Stacked in reading order: the first column's contents, then the second column.
    expect(narrow.signUp.y).toBeGreaterThan(narrow.volunteer.y)
    expect(narrow.pta.y).toBeGreaterThan(narrow.signUp.y)
    // No sideways scroll at phone width (WCAG 1.4.10).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('@a11y has no critical or serious axe violations', async ({ page, baseURL }) => {
    await page.goto(siteUrl(baseURL, 'a.localhost', `/${made.slug}`))
    await expect(page.getByRole('heading', { level: 2, name: 'Ways to help' })).toBeVisible({
      timeout: 20_000,
    })
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const blocking = results.violations.filter((v) =>
      ['critical', 'serious'].includes(v.impact ?? ''),
    )
    expect(blocking.map((v) => v.id)).toEqual([])
  })
})
