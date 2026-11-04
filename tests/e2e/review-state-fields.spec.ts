import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

import { assignTenant } from './support/admin-form'
import { adminCredentials, adminTest as test } from './support/admin-session'

/**
 * The review-state field on the page form (`04` §4.1).
 *
 * A read-only `radio`, chosen over a `select` because Payload's select fails this gate (an
 * unnamed combobox input — see `settings-fields.spec.ts`). This is the check that the choice
 * holds. Scoped to the field, for the reason `page-seo-fields.spec.ts` gives.
 *
 * The note and the two queue fields are not audited here: the note renders only on a page
 * sent back (it is a plain textarea, like the SEO description), and the queue fields are
 * hidden.
 */

const credentials = adminCredentials()

const BLOCKING_IMPACTS = ['critical', 'serious']

test.describe('review state on the page form', () => {
  test.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/collections/pages/create')
    await assignTenant(page, 'DD2 District')
  })

  test('@smoke shows the state read-only — it is moved by actions, not typed', async ({ page }) => {
    const field = page.locator('#field-reviewState')
    await expect(field).toBeVisible({ timeout: 20_000 })
    // Being edited, Waiting, Changes requested, and Scheduled (a page's Start, Jason 2026-11-04).
    await expect(field.getByRole('radio')).toHaveCount(4)
    for (const radio of await field.getByRole('radio').all()) {
      await expect(radio).toBeDisabled()
    }
    await expect(page.locator('#field-reviewNote')).toHaveCount(0)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`in the ${colorScheme} theme`, () => {
      test.use({ colorScheme })

      test('@smoke @a11y has zero critical or serious axe violations', async ({ page }) => {
        await expect(page.locator('#field-reviewState')).toBeVisible({ timeout: 20_000 })

        const results = await new AxeBuilder({ page })
          .include('#field-reviewState')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()

        const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ''))

        expect(
          blocking,
          `Blocking a11y violations in the review-state field:\n${blocking
            .map(
              (v) =>
                `  [${v.impact}] ${v.id}: ${v.help}\n` +
                v.nodes
                  .map((n) => `      ${n.html.slice(0, 160)}\n      ${n.any[0]?.message ?? ''}`)
                  .join('\n'),
            )
            .join('\n')}`,
        ).toEqual([])
      })
    })
  }
})
