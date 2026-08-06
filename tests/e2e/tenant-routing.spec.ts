import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * Tenant + locale delivery path (`02` §4.1, §5; `08` §5–6).
 *
 * Proves the Phase 2 exit criteria that can be proven locally: a request resolves to the
 * right tenant by Host, locale routing works with correct `lang`/`dir`, and an unknown host
 * 404s rather than falling back to a default tenant.
 *
 * Fixtures come from `pnpm run seed` (`06` §4). Tenants are reached by their REAL
 * hostnames: `*.localhost` resolves to loopback per RFC 6761, so no `/etc/hosts` entry and
 * no DNS setup is needed — which is exactly why the local environment is specified that way.
 *
 * Note the Host header cannot be overridden instead: browsers treat `Host` as a forbidden
 * header, and Chromium rejects the request outright. Driving real hostnames is also the
 * more faithful test, since it exercises the same path a visitor takes.
 */

const PORT = Number(process.env.PORT ?? 3000)
const site = (host: string) => ({ baseURL: `http://${host}:${PORT}` })

test.describe('tenant resolution by Host', () => {
  test.use(site('a.localhost'))

  test('@smoke resolves the correct tenant', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('tenant-slug')).toHaveText('school-a')
    await expect(page.getByTestId('tenant-type')).toHaveText('school')
  })

  test('@smoke defaults to the source locale on an unprefixed path', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('locale')).toHaveText('en')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  })
})

test.describe('a second tenant is served its own content', () => {
  test.use(site('b.localhost'))

  test('@smoke does not receive tenant A from a shared cache entry', async ({ page }) => {
    /**
     * THE REASON THE REWRITE EXISTS. Next caches by pathname, not by Host. Without folding
     * the hostname into the cache key, 28 tenants would share one entry per path and this
     * assertion would return school-a — a tenant leak occurring in the CDN, where no access
     * function could ever catch it.
     */
    await page.goto('/')
    await expect(page.getByTestId('tenant-slug')).toHaveText('school-b')
  })
})

test.describe('locale routing', () => {
  test.use(site('a.localhost'))

  test('@smoke serves a Tier 1 locale under its path prefix', async ({ page }) => {
    await page.goto('/es/athletics')
    await expect(page.getByTestId('locale')).toHaveText('es')
    await expect(page.getByTestId('path')).toHaveText('/athletics')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  })

  test('@smoke @rtl sets dir="rtl" for Arabic', async ({ page }) => {
    // Release-blocking (`08` §6). Verified from Phase 2 so RTL is never a retrofit.
    await page.goto('/ar')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  })

  test('@smoke treats an unknown prefix as a path, not a locale', async ({ page }) => {
    await page.goto('/staff/directory')
    await expect(page.getByTestId('locale')).toHaveText('en')
    await expect(page.getByTestId('path')).toHaveText('/staff/directory')
  })

  test('@smoke language switcher lists each language in its own script', async ({ page }) => {
    /**
     * `08` §6 — each option carries `lang` and is written as its own speakers write it.
     * Never flag icons: a flag is a country, not a language.
     */
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Language' })
    await expect(nav.getByRole('link', { name: 'Español' })).toHaveAttribute('lang', 'es')
    await expect(nav.getByRole('link', { name: '한국어' })).toHaveAttribute('lang', 'ko')
    await expect(nav.getByRole('link', { name: 'العربية' })).toHaveAttribute('lang', 'ar')
  })

  test('@smoke @a11y a localized page has zero critical or serious axe violations', async ({
    page,
  }) => {
    await page.goto('/ar')
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const blocking = results.violations.filter((v) =>
      ['critical', 'serious'].includes(v.impact ?? ''),
    )
    expect(blocking.map((v) => v.id)).toEqual([])
  })
})

test.describe('unknown hosts', () => {
  test.use(site('unknown.localhost'))

  test('@smoke 404 rather than falling back to a default tenant', async ({ page }) => {
    // `02` §4.1 — a fallback would serve one school's content on another school's domain.
    // `unknown.localhost` resolves to loopback but matches no tenant row.
    const response = await page.goto('/')
    expect(response?.status()).toBe(404)
  })
})

test.describe('the rewrite target is not directly reachable', () => {
  test.use(site('a.localhost'))

  test('@smoke refuses a direct /sites/ request', async ({ page }) => {
    // Otherwise another tenant's cached artifact could be requested by path.
    const response = await page.goto('/sites/b.localhost/en')
    expect(response?.status()).toBe(404)
  })
})
