import { expect, type Page } from '@playwright/test'

/**
 * Opens the district's Page settings dialog (the toolbar's gear, Jason 2026-10-29).
 *
 * Retried: the gear is server-rendered, so it is on screen before the page has hydrated, and a
 * click in that moment does nothing. A person clicks again; so does this.
 */
export const openPageSettings = async (page: Page) => {
  const dialog = page.getByRole('dialog', { name: 'Page settings' })
  await expect(async () => {
    await page.getByRole('button', { name: 'Page settings' }).click({ timeout: 5_000 })
    await expect(dialog).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  return dialog
}

/** Shows one of the dialog's tabs (Jason, 2026-11-11): Page, Linking, SEO or Access. */
export const showSettingsTab = async (page: Page, name: 'Page' | 'Linking' | 'SEO' | 'Access') => {
  const tab = page.getByRole('tab', { name, exact: true })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}
