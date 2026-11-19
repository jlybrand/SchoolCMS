import { expect } from '@playwright/test'

import { adminCredentials, adminTest as test } from './support/admin-session'
import { expectNoBlockingViolations } from './support/fixture-pages'
import { SCHOOL_MANAGER_EMAIL } from './support/school-session'

/**
 * Choosing which district admins get the district's mail (Jason, 2026-10-23).
 *
 * The setting shows on a district admin's user form, on by default, and not on a school
 * manager's. Read-only here: the opt-out itself and the fall-back to everyone are in
 * `tests/integration/district-digest.test.ts`, and turning the signed-in admin's own mail off
 * would leave the local database quieter than its owner expects.
 */

const credentials = adminCredentials()
const LABEL = 'Email this person the approval digest and district alerts'

const userId = async (request: import('@playwright/test').APIRequestContext, email: string) => {
  const res = await request.get(
    `/api/users?where[email][equals]=${encodeURIComponent(email)}&limit=1&depth=0`,
  )
  expect(res.ok(), `user lookup for ${email}`).toBe(true)
  const [user] = (await res.json()).docs as { id: number }[]
  expect(user, `${email} exists`).toBeDefined()
  return user!.id
}

test.describe('district alert recipients', () => {
  test.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  test('@smoke a district admin’s form has the setting, on by default', async ({ page }) => {
    await page.goto(`/admin/collections/users/${await userId(page.request, credentials!.email)}`)
    const box = page.getByRole('checkbox', { name: LABEL })
    await expect(box).toBeEnabled({ timeout: 20_000 })
    await expect(box).toBeChecked()
  })

  test('@smoke a school manager’s form does not', async ({ page }) => {
    await page.goto(`/admin/collections/users/${await userId(page.request, SCHOOL_MANAGER_EMAIL)}`)
    await expect(page.locator('#field-email')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('checkbox', { name: LABEL })).toHaveCount(0)
  })

  test('@smoke @a11y the setting has zero critical or serious axe violations', async ({ page }) => {
    await page.goto(`/admin/collections/users/${await userId(page.request, credentials!.email)}`)
    await expect(page.getByRole('checkbox', { name: LABEL })).toBeEnabled({ timeout: 20_000 })
    const field = '.field-type.checkbox:has(#field-receivesAlerts)'
    // axe passes an empty selection, so prove the selector reaches the field first.
    await expect(page.locator(field)).toHaveCount(1)
    await expectNoBlockingViolations(page, field)
  })
})
