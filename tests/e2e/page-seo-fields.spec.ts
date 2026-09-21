import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

import { assignTenant } from './support/admin-form'
import { adminCredentials, adminTest as test } from './support/admin-session'

/**
 * The SEO fields on the page form (`01` §3 item 13).
 *
 * THIS SPEC IS WHY THEY ARE PLAIN FIELDS. It was written against `plugin-seo`, and failed:
 * the plugin's hint text is `#9A9A9A` on white (2.81:1) and its length pills are white on
 * `red`/`orangered`, hardcoded inline. Non-negotiable rule 6 covers both admin planes, and
 * third-party admin UI is still UI this repo chose to ship — so the plugin was not adopted
 * (src/collections/Pages.ts). It stays as the check that whatever renders this group, now
 * or after a future change of mind, meets the bar.
 *
 * Scoped to the group, for the reason `paste-normalizer.spec.ts` gives: Payload's own chrome
 * joins the gate in Phase 4 (`07` §2).
 */

const credentials = adminCredentials()

const BLOCKING_IMPACTS = ['critical', 'serious']

test.describe('SEO fields on the page form', () => {
  test.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/collections/pages/create')
    await assignTenant(page, 'DD2 District')
  })

  test('@smoke offers a title and a description, and no image until `media` exists', async ({
    page,
  }) => {
    await expect(page.locator('#field-meta')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[name="meta.title"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[name="meta.description"]')).toBeVisible()
    // An image field here would be an upload with no alt-text gate behind it (rule 7).
    await expect(page.locator('[name="meta.image"]')).toHaveCount(0)
  })

  /**
   * Both of Payload's themes. The help-text correction in
   * `src/app/(payload)/admin-overrides.css` uses an elevation token BECAUSE that scale inverts
   * in the dark theme — a claim worth checking rather than trusting, since a hex that fixed
   * light mode would have broken dark.
   */
  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`in the ${colorScheme} theme`, () => {
      test.use({ colorScheme })

      test('@smoke @a11y have zero critical or serious axe violations', async ({ page }) => {
        const title = page.locator('[name="meta.title"]')
        await expect(title).toBeVisible({ timeout: 20_000 })
        await title.fill('Meet School A')

        const results = await new AxeBuilder({ page })
          .include('#field-meta')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()

        const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ''))

        expect(
          blocking,
          `Blocking a11y violations in the SEO fields:\n${blocking
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
