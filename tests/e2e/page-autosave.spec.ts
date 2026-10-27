import { expect } from '@playwright/test'

import { adminCredentials, adminTest as test } from './support/admin-session'
import { siteUrl } from './support/site-url'

/**
 * A change to a page saves itself (`04` §2.3 — "Nothing is lost on submit. In-progress work
 * autosaves as a draft").
 *
 * Asserted as behaviour: change a field, press nothing, reload, and the change is still
 * there. And the public page is not: an autosave is a draft beside the live version, never a
 * publish.
 */

const credentials = adminCredentials()

test.describe('page autosave', () => {
  test.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  test('@smoke a changed field is kept without pressing save, and stays off the live page', async ({
    page,
  }) => {
    // The district's own front page: seeded, published, on the bare `localhost` tenant.
    const found = await page.request.get(
      '/api/pages?where[slug][equals]=home&where[tenant.hostname][equals]=localhost&limit=1&depth=0',
    )
    const [home] = (await found.json()).docs as { id: number; title: string }[]
    expect(home, 'the seed creates a front page for the district').toBeDefined()

    await page.goto(`/admin/collections/pages/${home!.id}`)
    const title = page.locator('#field-title')
    await expect(title).toBeEditable({ timeout: 20_000 })

    /**
     * Payload's autosave ignores the form state it sees when it MOUNTS, and its element is
     * server-rendered, so nothing visible says it has mounted. Under a parallel run the first
     * edit can land before it does and be taken as the starting state. So this types the way a
     * person does — a change, and if nothing has saved within a few seconds, another one. Any
     * change after mount saves; the last one typed is what must survive the reload.
     */
    const isAutosave = (res: { url(): string; ok(): boolean }) =>
      res.url().includes(`/api/pages/${home!.id}`) &&
      res.url().includes('autosave=true') &&
      res.ok()

    let draftTitle = ''
    let saved = false
    for (let attempt = 1; attempt <= 5 && !saved; attempt += 1) {
      draftTitle = `Draft title ${Date.now()}`
      // Listening BEFORE typing, so a fast save is not missed.
      const autosaved = page.waitForResponse(isAutosave, { timeout: 4_000 }).then(
        () => true,
        () => false,
      )
      // No click.
      await title.fill(draftTitle)
      saved = await autosaved
    }
    expect(saved, 'a changed field saved itself without a click').toBe(true)

    await page.reload()
    await expect(page.locator('#field-title')).toHaveValue(draftTitle, { timeout: 20_000 })

    const publicPage = await page.request.get(siteUrl(test.info().project.use.baseURL, 'localhost'))
    expect(await publicPage.text()).not.toContain(draftTitle)
  })
})
