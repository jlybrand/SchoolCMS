import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

import { adminCredentials, adminTest as test } from './support/admin-session'

/**
 * The `settings` form (`03` §5).
 *
 * THIS SPEC IS WHY THE LANGUAGES ARE CHECKBOXES. They were a multi-select, and it failed here:
 * Payload's select nests a remove button inside a draggable `role="button"` and leaves its
 * search box without an accessible name (src/collections/Settings.ts). Non-negotiable rule 6
 * covers both admin planes, so the field changed and this stays as the check on whatever
 * renders it next.
 *
 * Scoped to the document's fields, for the reason `paste-normalizer.spec.ts` gives: Payload's
 * own chrome joins the gate in Phase 4 (`07` §2). ONE KNOWN FAILURE IS EXCLUDED BY NAME
 * rather than by narrowing the scope until it falls outside: the row-actions menu in every
 * array field's header is a `<button>` with no accessible name (critical, `button-name`).
 * It is Payload's markup, not a value, so `admin-overrides.css` cannot reach it; it is also
 * on the Menus form, and it is on the Phase 4 list. Remove the exclusion when it is fixed —
 * the test will say so by still passing.
 *
 * Opened for the district tenant, which the seed gives no `settings` row, so this is always
 * the create form and the test never edits data another spec reads. No tenant modal here,
 * unlike `pages`: an `isGlobal` collection belongs to whichever site the admin's tenant
 * selector names, and the plugin keeps that in the `payload-tenant` cookie — set explicitly,
 * because otherwise it is whatever the last spec left behind.
 */

const credentials = adminCredentials()

const BLOCKING_IMPACTS = ['critical', 'serious']

test.describe('the settings form', () => {
  test.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  test.beforeEach(async ({ page, baseURL }) => {
    const response = await page.request.get('/api/tenants?where[slug][equals]=district&depth=0')
    const { docs } = (await response.json()) as { docs: { id: number }[] }
    const district = docs[0]
    if (!district) throw new Error('the seeded district tenant is missing — run `pnpm run seed`')

    await page
      .context()
      .addCookies([{ name: 'payload-tenant', value: String(district.id), url: baseURL ?? '' }])
    await page.goto('/admin/collections/settings/create')
  })

  test('@smoke starts with every platform language on, and no image until `media` exists', async ({
    page,
  }) => {
    const languages = page.locator('#field-enabledLocales')
    await expect(languages).toBeVisible({ timeout: 20_000 })
    // On by default: turning a language OFF is the deliberate act (`08` §10).
    for (const name of ['Español', '简体中文', '한국어', 'Português', 'العربية']) {
      await expect(languages.getByRole('checkbox', { name, exact: true })).toBeChecked()
    }
    // English is not an option because it is not optional.
    await expect(languages.getByRole('checkbox', { name: 'English' })).toHaveCount(0)
    // A default share image would be an upload with no alt-text gate behind it (rule 7).
    await expect(page.locator('[name="defaultImage"]')).toHaveCount(0)
  })

  test('@smoke refuses a phone number nobody can dial, and says which field', async ({ page }) => {
    const phone = page.locator('[name="contact.phone"]')
    // Enabled, not just visible: Payload disables the form until it has hydrated, and a Save
    // clicked before then goes nowhere.
    await expect(phone).toBeEnabled({ timeout: 20_000 })
    await phone.fill('call the office')
    await page.getByRole('button', { name: 'Save' }).click()

    /**
     * The field is NAMED; the validator's own sentence is not shown, and that is a known gap
     * rather than the design. In the production build the REST response carries only
     * Payload's summary — `formatErrors` tests `instanceof ValidationError`, and the bundle
     * holds more than one copy of that class — so the per-field message never reaches the
     * form. It affects every custom validator in the admin, not this form, and is tracked in
     * docs/phases/03 §24. Tighten this to the sentence when that is fixed.
     */
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Phone' })).toContainText(
      'The following field is invalid',
    )
    // Still the create form: nothing was saved.
    await expect(page).toHaveURL(/\/settings\/create/)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`in the ${colorScheme} theme`, () => {
      test.use({ colorScheme })

      test('@smoke @a11y has zero critical or serious axe violations', async ({ page }) => {
        await expect(page.locator('#field-enabledLocales')).toBeVisible({ timeout: 20_000 })
        // Payload disables every input while the form initialises; a disabled input is greyed,
        // and axe would be measuring a state nobody types into.
        await expect(page.locator('[name="siteTitle"]')).toBeEnabled()

        const results = await new AxeBuilder({ page })
          .include('.document-fields')
          .exclude('.array-field__header .popup-button')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()

        const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ''))

        expect(
          blocking,
          `Blocking a11y violations in the settings form:\n${blocking
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
