import { expect, type Page } from '@playwright/test'

/**
 * Assign the new page to a tenant.
 *
 * Not test scaffolding to be engineered away — this is the real flow. A district-admin works
 * across all 28 sites (`04` §3.2), so the multi-tenant plugin asks which one a new page belongs
 * to before the form is usable. Seeding the admin with a default tenant would skip the modal
 * and hide a step every district author actually takes.
 */
export const assignTenant = async (page: Page, tenant: string) => {
  const modal = page.locator('#assign-tenant-field-modal')

  /**
   * Waited for, not checked for. The modal renders after hydration, so an "if it is there"
   * probe returns early on a fast machine and then the modal opens over the form mid-test —
   * which is how five of these failed while three passed, purely on timing. This user has no
   * tenant selected, so the modal is not optional; asserting it makes the step deterministic.
   */
  await expect(modal).toBeVisible({ timeout: 20_000 })

  await modal.locator('.rs__control').click()
  await page.getByRole('option', { name: tenant }).click()
  await modal.getByRole('button', { name: 'Confirm' }).click()
  await expect(modal).toBeHidden()
}
