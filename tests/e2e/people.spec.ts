import { expect, type APIRequestContext } from '@playwright/test'

import { adminCredentials, adminTest } from './support/admin-session'
import { schoolTest } from './support/school-session'

/**
 * The staff directory's admin (Jason, 2026-11-13): the district's only. Staff come from CSI —
 * none is added in the dashboard — and the district makes sub-groups inside a school's group,
 * ticking who is in them. Built, then locked here (CLAUDE.md: admin views are not test-first);
 * the rules are `tests/unit/access/people.test.ts`, `tests/unit/lib/staff-groups.test.ts` and
 * `tests/integration/people.test.ts`; whole-screen axe is `admin-planes-axe.spec.ts`. Uses the
 * seed's mock school ("SHS (mock)") and its mock staff.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

const mockSchool = async (request: APIRequestContext) => {
  const res = await request.get(
    '/api/staff-groups?where[csiLocationId][equals]=MOCK-SHS&depth=0&limit=1',
  )
  const school = ((await res.json()).docs as { id: number; name: string }[])[0]
  expect(school, 'the seed’s mock school — run `pnpm run seed`').toBeTruthy()
  return school!
}

adminTest.describe('the district', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest('sees the staff from CSI, read-only, and cannot add anyone', async ({ page }) => {
    await page.goto('/admin/collections/people')
    await expect(page.getByRole('link', { name: 'Avery Mockwell' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByRole('link', { name: /create new/i })).toHaveCount(0)

    await page.getByRole('link', { name: 'Avery Mockwell' }).click()
    await expect(page.locator('#field-sortName')).toBeEditable({ timeout: 20_000 })
    await expect(page.locator('#field-name')).not.toBeEditable()
    await expect(page.locator('#field-title')).not.toBeEditable()
  })

  adminTest('makes a sub-group in a school and ticks who is in it', async ({ page }) => {
    const school = await mockSchool(page.request)
    const name = `Nurses ${Date.now()}`
    let id: number | null = null
    try {
      await page.goto('/admin/collections/staff-groups/create')
      await page.locator('#field-name').fill(name)
      // Before a school is chosen, the list says what to do.
      const members = page.locator('#staff-group-members')
      await expect(members).toContainText('Choose the school first.')
      await page.locator('#field-parent').click()
      await page.getByRole('option', { name: school.name }).click()

      // The school's staff, A–Z by last name; find by name, tick.
      await expect(members.getByRole('checkbox')).toHaveCount(8)
      await expect(members.getByRole('checkbox').first()).toHaveAccessibleName(
        /Jose|José Álvarez-Mock/,
      )
      await members.getByLabel('Find by name').fill('dana')
      await expect(members.getByRole('checkbox')).toHaveCount(1)
      await members.getByRole('checkbox', { name: /Dana Example/ }).check()
      await expect(members.getByRole('status')).toHaveText('1 of 8 ticked')

      await page.locator('#action-save').click()
      await expect(page).toHaveURL(/\/admin\/collections\/staff-groups\/\d+$/, { timeout: 20_000 })
      id = Number(/\/staff-groups\/(\d+)$/.exec(page.url())?.[1])
      const saved = (await (await page.request.get(`/api/staff-groups/${id}?depth=1`)).json()) as {
        label: string
        members: { name: string }[]
      }
      expect(saved.label).toBe(`${school.name} › ${name}`)
      expect(saved.members.map((m) => m.name)).toEqual(['Dana Example'])

      // Unticked again: out.
      await page.reload()
      await page
        .locator('#staff-group-members')
        .getByRole('checkbox', { name: /Dana Example/ })
        .uncheck()
      await page.locator('#action-save').click()
      await expect
        .poll(async () => {
          const res = await page.request.get(`/api/staff-groups/${id}?depth=0`)
          return ((await res.json()) as { members: unknown[] }).members.length
        })
        .toBe(0)
    } finally {
      if (id !== null) await page.request.delete(`/api/staff-groups/${id}`)
    }
  })
})

schoolTest.describe('a school manager', () => {
  schoolTest.skip(credentials === null, SKIP)

  schoolTest('neither sees nor reaches the staff directory', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.locator('#school-home')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: 'Staff', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Staff groups', exact: true })).toHaveCount(0)
    expect((await page.request.get('/api/people')).status()).toBe(403)
    expect((await page.request.get('/api/staff-groups')).status()).toBe(403)
  })
})
