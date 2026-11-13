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
import { tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * A staff list on the public site (Jason, 2026-11-13): a school's group, or a sub-group in it,
 * A–Z by last name, each person with an email link named for them; a name filter once the list
 * is long. Uses the seed's mock school ("SHS (mock)", eight mock staff from the mock CSI sync).
 * The rules are `tests/integration/staff-directory.test.ts`; the component's own axe, LTR and
 * RTL, is the Storybook gate.
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

type Fixture = { admin: APIRequestContext; page: number; group: number; slug: string }

const setUp = async (baseURL: string | undefined): Promise<Fixture> => {
  const admin = await playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })
  const schools = await admin.get(
    '/api/staff-groups?where[csiLocationId][equals]=MOCK-SHS&depth=0&limit=1',
  )
  const school = ((await schools.json()).docs as { id: number }[])[0]
  expect(school, 'the seed’s mock school — run `pnpm run seed`').toBeTruthy()
  const staff = (
    (await (
      await admin.get(`/api/people?where[group][equals]=${school!.id}&depth=0&limit=0`)
    ).json()) as { docs: { id: number; name: string }[] }
  ).docs
  const counselor = staff.find((p) => p.name === 'Casey Sample')!
  const made = await admin.post('/api/staff-groups?depth=0', {
    data: { name: `Counselors ${Date.now()}`, parent: school!.id, members: [counselor.id] },
  })
  expect(made.ok(), await made.text()).toBe(true)
  const group = ((await made.json()).doc as { id: number }).id

  const slug = `staff-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const page = await admin.post('/api/pages?depth=0', {
    data: {
      tenant: await tenantIdFor(admin, 'b.localhost'),
      title: uniqueTitle('Our staff'),
      slug,
      visibility: 'public',
      layout: [
        { blockType: 'staffList', heading: 'All staff', group: school!.id, maxColumns: '4' },
        { blockType: 'staffList', heading: 'Counselors', group },
        { blockType: 'staffList', heading: 'Three across', group: school!.id, maxColumns: '3' },
        { blockType: 'staffList', heading: 'Two across', group: school!.id, maxColumns: '2' },
      ],
      _status: 'published',
    },
  })
  expect(page.ok(), await page.text()).toBe(true)
  return { admin, page: ((await page.json()).doc as { id: number }).id, group, slug }
}

const tearDown = async ({ admin, page, group }: Fixture) => {
  await admin.delete(`/api/pages/${page}`)
  await admin.delete(`/api/staff-groups/${group}`)
  await admin.dispose()
}

const open = async (page: Page, baseURL: string | undefined, slug: string) =>
  expect(async () => {
    await page.goto(siteUrl(baseURL, 'b.localhost', `/${slug}`))
    await expect(page.getByRole('region', { name: 'All staff' })).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

test.describe('a staff list on a page', () => {
  test.skip(credentials === null, SKIP)

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@a11y a school's staff and a sub-group, A–Z, each with an email link — ${colorScheme}`, async ({
      page,
      baseURL,
    }) => {
      await page.emulateMedia({ colorScheme })
      const fixture = await setUp(baseURL)
      try {
        await open(page, baseURL, fixture.slug)
        const all = page.getByRole('region', { name: 'All staff' })
        // A–Z by last name.
        await expect(all.getByRole('listitem').locator('p:first-child')).toHaveText([
          'José Álvarez-Mock',
          'Dana Example',
          'Finley Fixture',
          'Avery Mockwell',
          'Emery Placeholder',
          'Casey Sample',
          'Gray Stub',
          'Blake Testman',
        ])
        // Titles as CSI gives them; an email link named for its person.
        await expect(all.getByText('Admin/teacher', { exact: true })).toBeVisible()
        const email = all.getByRole('link', { name: 'Email Dana Example' })
        await expect(email).toHaveAttribute('href', /^mailto:.+@example\.org$/)
        // Eight people: no filter yet (it appears from ten).
        await expect(all.getByRole('searchbox')).toHaveCount(0)
        // At most N side by side, at desktop width (Jason, 2026-11-13): exactly N share the
        // first row and the next person starts the second. 3 and 4 need more room than the text
        // column, so those lists widen — short of the screen's edges, never scrolling sideways.
        for (const [name, n] of [
          ['All staff', 4],
          ['Three across', 3],
          ['Two across', 2],
        ] as const) {
          const tops = await page
            .getByRole('region', { name })
            .getByRole('listitem')
            .evaluateAll((items) => items.map((li) => Math.round(li.getBoundingClientRect().top)))
          expect(tops.slice(0, n), `${name}: the first row`).toEqual(Array(n).fill(tops[0]))
          expect(tops[n], `${name}: the next row`).toBeGreaterThan(tops[0]!)
        }
        const edges = await all.evaluate((el) => {
          const box = el.getBoundingClientRect()
          const page = document.documentElement
          return {
            start: box.left,
            end: page.clientWidth - box.right,
            sideways: page.scrollWidth - page.clientWidth,
          }
        })
        expect(edges.start).toBeGreaterThanOrEqual(24)
        expect(edges.end).toBeGreaterThanOrEqual(24)
        expect(edges.sideways).toBe(0)

        const counselors = page.getByRole('region', { name: 'Counselors' })
        await expect(counselors.getByRole('listitem')).toHaveCount(1)
        await expect(counselors).toContainText('Casey Sample')
        await expect(counselors).toContainText('School Counselor')

        expect(await blockingViolations(page)).toEqual([])
      } finally {
        await tearDown(fixture)
      }
    })
  }
})
