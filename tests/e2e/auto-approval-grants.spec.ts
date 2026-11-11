import { randomBytes } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { adminCredentials, adminTest as test } from './support/admin-session'
import { followLink } from './support/follow-link'
import { SCHOOL_HOSTNAME, tenantIdFor } from './support/school-session'

/**
 * Auto-approval grants in the district plane (`04` §4.3).
 *
 * The users form shows the grant as native checkboxes, not Payload's select — whose input fails
 * this gate (`settings-fields.spec.ts`). The dashboard lists who holds a grant. The flow issues
 * one, sees it listed, and revokes it, so a run leaves no grant behind: the launch posture is
 * zero grants issued.
 *
 * The holder is an account nobody signs in as — created by the admin, with a random password.
 */

const credentials = adminCredentials()

const BLOCKING_IMPACTS = ['critical', 'serious']

const HOLDER_EMAIL = 'e2e-grant-holder@example.invalid'
const HOLDER_NAME = 'E2E Grant Holder'

const ensureHolder = async (request: APIRequestContext): Promise<number> => {
  const tenant = await tenantIdFor(request, SCHOOL_HOSTNAME)
  const found = await request.get(
    `/api/users?where[email][equals]=${encodeURIComponent(HOLDER_EMAIL)}&limit=1&depth=0`,
  )
  expect(found.ok(), 'user lookup as the district admin').toBe(true)
  const [existing] = (await found.json()).docs as { id: number }[]
  const data = {
    name: HOLDER_NAME,
    roles: ['school-manager'],
    tenants: [{ tenant }],
    autoApprove: [],
  }
  const res = existing
    ? await request.patch(`/api/users/${existing.id}`, { data })
    : await request.post('/api/users', {
        data: {
          ...data,
          email: HOLDER_EMAIL,
          password: `e2e-${randomBytes(18).toString('base64url')}`,
        },
      })
  expect(res.ok(), `upsert grant holder: ${res.status()} ${await res.text()}`).toBe(true)
  return existing ? existing.id : ((await res.json()).doc as { id: number }).id
}

const storedGrants = async (request: APIRequestContext, id: number): Promise<unknown> =>
  ((await (await request.get(`/api/users/${id}?depth=0`)).json()) as { autoApprove?: unknown })
    .autoApprove ?? []

/**
 * Tick or untick one scope and save, retried until the server holds the change.
 *
 * Enabled is not settled. Under a full parallel run the form can re-render from its stored
 * state after the box is enabled, discarding the tick: Save goes back to disabled and nothing is
 * written (seen as a stored `[]` where `['posts.routine']` was expected). A retry meets a
 * settled form, and the stored value — not the toast — decides when it worked.
 */
const setGrant = async (
  page: Page,
  box: Locator,
  on: boolean,
  id: number,
  expected: string[],
): Promise<void> => {
  await expect(async () => {
    // A save that landed after the last attempt's poll gave up leaves Save disabled.
    if (JSON.stringify(await storedGrants(page.request, id)) === JSON.stringify(expected)) return
    await box.setChecked(on, { timeout: 5_000 })
    await expect(box).toBeChecked({ checked: on, timeout: 1_000 })
    await page.getByRole('button', { name: 'Save' }).click({ timeout: 5_000 })
    await expect.poll(() => storedGrants(page.request, id), { timeout: 5_000 }).toEqual(expected)
  }).toPass({ intervals: [500, 1_000], timeout: 30_000 })
}

const audit = async (page: Page, selector: string) => {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ''))
  expect(
    blocking,
    `Blocking a11y violations in ${selector}:\n${blocking
      .map(
        (v) =>
          `  [${v.impact}] ${v.id}: ${v.help}\n` +
          v.nodes
            .map((n) => `      ${n.html.slice(0, 160)}\n      ${n.any[0]?.message ?? ''}`)
            .join('\n'),
      )
      .join('\n')}`,
  ).toEqual([])
}

test.describe('auto-approval grants', () => {
  test.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  // One shared holder account: each test sets and clears its grants, so they must not overlap.
  test.describe.configure({ mode: 'serial' })

  let holderId: number

  test.beforeEach(async ({ page }) => {
    holderId = await ensureHolder(page.request)
  })

  test.afterEach(async ({ page }) => {
    await page.request.patch(`/api/users/${holderId}`, { data: { autoApprove: [] } })
  })

  test('@smoke a district admin grants a scope, sees it on the dashboard, and revokes it', async ({
    page,
  }) => {
    await page.goto(`/admin/collections/users/${holderId}`)
    const field = page.locator('#field-autoApprove')
    const posts = field.getByRole('checkbox', { name: 'Posts: routine posts' })
    // Enabled, not just visible: a click before hydration goes nowhere.
    await expect(posts).toBeEnabled({ timeout: 20_000 })
    await expect(page.getByRole('group', { name: 'Auto-approval' })).toHaveAttribute(
      'id',
      'field-autoApprove',
    )
    // One scope: `events.schedule` was removed (events skip approval, 2026-11-11).
    await expect(field.getByRole('checkbox')).toHaveCount(1)
    await expect(posts).not.toBeChecked()

    await setGrant(page, posts, true, holderId, ['posts.routine'])

    await page.goto('/admin')
    const panel = page.locator('#grants-panel')
    await expect(panel.getByRole('heading', { name: 'Auto-approval grants' })).toBeVisible({
      timeout: 20_000,
    })
    const row = panel.getByRole('listitem').filter({ hasText: HOLDER_NAME })
    await expect(row).toContainText('Posts: routine posts')

    await followLink(
      page,
      row.getByRole('link', { name: HOLDER_NAME }),
      new RegExp(`/admin/collections/users/${holderId}$`),
    )
    await expect(posts).toBeEnabled({ timeout: 20_000 })
    await expect(posts).toBeChecked()
    await setGrant(page, posts, false, holderId, [])

    await page.goto('/admin')
    await expect(panel.getByRole('heading', { name: 'Auto-approval grants' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(panel.getByText(HOLDER_NAME)).toHaveCount(0)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`in the ${colorScheme} theme`, () => {
      test.use({ colorScheme })

      test('@smoke @a11y the grant field has zero critical or serious axe violations', async ({
        page,
      }) => {
        await page.goto(`/admin/collections/users/${holderId}`)
        await expect(page.locator('#field-autoApprove').getByRole('checkbox').first()).toBeEnabled({
          timeout: 20_000,
        })
        await audit(page, '#field-autoApprove')
      })

      test('@smoke @a11y the dashboard panel has zero critical or serious axe violations', async ({
        page,
      }) => {
        // With a holder listed, so the link is audited too.
        await page.request.patch(`/api/users/${holderId}`, {
          data: { autoApprove: ['posts.routine'] },
        })
        await page.goto('/admin')
        await expect(
          page.locator('#grants-panel').getByRole('link', { name: HOLDER_NAME }),
        ).toBeVisible({ timeout: 20_000 })
        await audit(page, '#grants-panel')
      })
    })
  }
})
