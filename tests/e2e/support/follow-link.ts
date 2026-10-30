import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Click a link in the admin and wait to land where it leads, retrying the click.
 *
 * A single click is not enough mid-suite. Payload's views settle AFTER they look ready: a list
 * view `router.replace`s its own URL to add `?depth=1&limit=10`, and the dashboard and lists
 * re-render after hydration. A click in that window is overwritten or lost — seen as a test still
 * on the list (`/post-boards?depth=1&limit=10`) 20s after clicking a board. A second click meets a
 * settled view. Once the URL matches, nothing is clicked again.
 */
export const followLink = async (page: Page, link: Locator, to: RegExp): Promise<void> => {
  await expect(async () => {
    if (to.test(new URL(page.url()).pathname)) return
    await link.click({ timeout: 5_000 })
    await page.waitForURL((url) => to.test(url.pathname), { timeout: 5_000 })
  }).toPass({ intervals: [500, 1_000], timeout: 30_000 })
}
