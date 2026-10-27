import { expect } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import {
  dropPage,
  makePage,
  openPage,
  schoolRequest,
  type FixturePage as Fixture,
} from './support/fixture-pages'
import { schoolTest as test } from './support/school-session'

/**
 * Page history is district-only (Jason, 2026-10-27).
 *
 * A school manager sees no Versions tab and cannot list or restore a version over REST — on
 * their OWN school's page, the case tenant isolation does not cover. The Local API cases are in
 * `tests/integration/tenant-isolation.test.ts`; this is the HTTP surface.
 *
 * NOT GraphQL, yet: the schema fails to build (the `autoApprove` values contain `:`, which
 * Payload's enum naming does not sanitise), so `/api/graphql` answers nothing to anyone. The
 * restore refusal is the same `beforeOperation` hook on every route; add the GraphQL case here
 * when the schema builds.
 */

const credentials = adminCredentials()

const versionIdsOf = async ({ id, admin }: Fixture) => {
  const res = await admin.get(
    `/api/pages/versions?where[parent][equals]=${id}&sort=createdAt&depth=0&limit=10`,
  )
  expect(res.ok(), 'the district lists versions').toBe(true)
  return ((await res.json()).docs as { id: string | number }[]).map((v) => String(v.id))
}

const latestTitle = async ({ id, admin }: Fixture) =>
  ((await (await admin.get(`/api/pages/${id}?draft=true&depth=0`)).json()) as { title: string })
    .title

test.describe('page history — school manager', () => {
  test.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  let fixture: Fixture
  let firstVersion: string
  test.beforeEach(async ({ baseURL }) => {
    fixture = await makePage(baseURL, { title: 'History first' })
    const res = await fixture.admin.patch(`/api/pages/${fixture.id}?draft=true&depth=0`, {
      data: { title: 'History second' },
    })
    expect(res.ok(), 'second draft').toBe(true)
    const [oldest] = await versionIdsOf(fixture)
    expect(oldest, 'the fixture has a version to restore').toBeDefined()
    firstVersion = oldest!
  })
  test.afterEach(async () => {
    await dropPage(fixture)
  })

  test('@smoke the page form has no Versions tab', async ({ page }) => {
    await openPage(page, fixture.id)
    await expect(page.getByRole('link', { name: 'Versions' })).toHaveCount(0)
  })

  test('@smoke cannot list or restore a version over REST', async ({ baseURL }) => {
    const school = await schoolRequest(baseURL)
    try {
      const list = await school.get(`/api/pages/versions?where[parent][equals]=${fixture.id}`)
      expect(list.status(), 'list versions').toBe(403)

      const restore = await school.post(`/api/pages/versions/${firstVersion}?draft=true`)
      expect(restore.ok(), `restore: ${restore.status()}`).toBe(false)
      expect(await latestTitle(fixture)).toBe('History second')
    } finally {
      await school.dispose()
    }
  })
})

adminTest.describe('page history — district admin', () => {
  adminTest.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  let fixture: Fixture
  adminTest.beforeEach(async ({ baseURL }) => {
    fixture = await makePage(baseURL, { title: 'History first' })
  })
  adminTest.afterEach(async () => {
    await dropPage(fixture)
  })

  adminTest('@smoke keeps the Versions tab', async ({ page }) => {
    await openPage(page, fixture.id)
    await expect(page.getByRole('link', { name: 'Versions' })).toBeVisible()
  })
})
