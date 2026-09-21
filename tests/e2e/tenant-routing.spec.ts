import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Tenant + locale delivery path (`02` §4.1, §5; `03` §2; `08` §5–6).
 *
 * Proves that a request resolves to the right tenant by Host, that locale routing produces
 * correct `lang`/`dir`/`hreflang`, that a path resolves to the tenant's own page, and that an
 * unknown host or unknown path 404s rather than falling back to something.
 *
 * WHAT THIS ASSERTS ON. The rendered page — its title, its heading, its `<head>` — not the
 * `data-testid` diagnostics it used to read. Those existed because the Phase 2 route rendered
 * no content and there was nothing else to look at. Now that it renders real pages, asserting
 * the page is both the stronger gate and the one that keeps working as templates change: a
 * testid can stay green while the page a visitor sees is wrong.
 *
 * Fixtures come from `pnpm run seed` (`06` §4), which gives every tenant a front page
 * (`home`), an `about` page, and `staff` nested under it. Tenants are reached by their REAL
 * hostnames: `*.localhost` resolves to loopback per RFC 6761, so no `/etc/hosts` entry and
 * no DNS setup is needed — which is exactly why the local environment is specified that way.
 *
 * Note the Host header cannot be overridden instead: browsers treat `Host` as a forbidden
 * header, and Chromium rejects the request outright. Driving real hostnames is also the
 * more faithful test, since it exercises the same path a visitor takes.
 */

const PORT = Number(process.env.PORT ?? 3000)
const site = (host: string) => ({ baseURL: `http://${host}:${PORT}` })

/**
 * Metadata is asserted on the HTTP RESPONSE, not the live DOM.
 *
 * Next streams metadata after the body when `generateMetadata` resolves later than the shell,
 * and React hoists it into `<head>` during hydration — so a fresh server puts these tags in
 * `<head>` and a warm one does not, and `head link[...]` is a locator whose truth depends on
 * timing. It failed deterministically once other specs had warmed the server and passed when
 * run alone.
 *
 * Asserting the response is also the more honest test. `hreflang` and the document title are
 * signals for crawlers and link previews, which parse the bytes and never hydrate. What
 * matters is that the markup is IN the response, not where the browser eventually files it.
 */
const documentFor = async (request: APIRequestContext, path: string) => {
  const response = await request.get(path)
  expect(response.status()).toBe(200)
  const html = await response.text()

  return {
    title: /<title>([^<]*)<\/title>/.exec(html)?.[1],
    /**
     * Parsed into a map rather than probed one tag at a time, so the assertion can be an
     * equality against the WHOLE set — a missing locale and a stray extra one both fail.
     * Case-insensitive because React emits the JSX prop spelling, `hrefLang`.
     */
    alternates: Object.fromEntries(
      [...html.matchAll(/<link[^>]*rel="alternate"[^>]*>/gi)].map((match) => [
        /hreflang="([^"]+)"/i.exec(match[0])?.[1],
        /href="([^"]+)"/i.exec(match[0])?.[1],
      ]),
    ),
  }
}

test.describe('tenant resolution by Host', () => {
  test.use(site('a.localhost'))

  test('@smoke resolves the correct tenant', async ({ page, request }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Home')

    // The front page is titled with the site's name — see `generateMetadata`. Every tenant's
    // front page ROW is called "Home", so the title is what distinguishes one site's front
    // page from another's.
    expect((await documentFor(request, '/')).title).toBe('School A')
  })

  test('@smoke renders the page body, not an empty shell', async ({ page }) => {
    await page.goto('/')
    // Proves the whole chain: Lexical in the database -> `toRichText` -> `RichText`. A route
    // that resolved the page but dropped its body would otherwise pass every other test here.
    await expect(page.getByText('Welcome. This is the seeded front page')).toBeVisible()
    // The author's "top-level heading" renders as h2, one step under the page title, because
    // the template owns the h1 (`07` §3). An editor cannot reach the element.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('What is on this site')
  })

  test('@smoke defaults to the source locale on an unprefixed path', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  })
})

test.describe('a second tenant is served its own content', () => {
  test.use(site('b.localhost'))

  test('@smoke does not receive tenant A from a shared cache entry', async ({ request }) => {
    /**
     * THE REASON THE REWRITE EXISTS. Next caches by pathname, not by Host. Without folding
     * the hostname into the cache key, 28 tenants would share one entry per path and this
     * assertion would return School A — a tenant leak occurring in the CDN, where no access
     * function could ever catch it.
     */
    expect((await documentFor(request, '/')).title).toBe('School B')
  })
})

test.describe('page resolution', () => {
  test.use(site('a.localhost'))

  test('@smoke resolves a nested page through its parent chain', async ({ page }) => {
    /**
     * `/about/staff` is walked segment by segment rather than read from a stored path
     * (`03` §2). It also proves `about` is read as a path segment and not mistaken for a
     * locale prefix.
     */
    await page.goto('/about/staff')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Staff Directory')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('@smoke an unknown path 404s rather than falling back to the front page', async ({
    page,
  }) => {
    // Serving the front page for a mistyped URL would put content under an address the
    // editor never published, and it would be cached there (`02` §5).
    const response = await page.goto('/athletics')
    expect(response?.status()).toBe(404)
  })

  test('@smoke the front page has exactly one URL', async ({ page }) => {
    /**
     * `/home` is REFUSED, not redirected. The front page is a top-level page slugged `home`,
     * and answering on both `/` and `/home` would give one page two URLs competing for one
     * CDN cache entry, and two candidates for the canonical.
     */
    const response = await page.goto('/home')
    expect(response?.status()).toBe(404)
  })
})

test.describe('site menus (`03` §5)', () => {
  test.use(site('a.localhost'))

  test('@smoke the header and footer are landmarks, and every menu is named', async ({ page }) => {
    await page.goto('/about')

    const banner = page.getByRole('banner')
    await expect(banner.getByRole('link', { name: 'School A' })).toHaveAttribute('href', '/')
    await expect(banner.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await expect(banner.getByRole('navigation', { name: 'Quick links' })).toBeVisible()
    await expect(
      page.getByRole('contentinfo').getByRole('navigation', { name: 'Footer' }),
    ).toBeVisible()
  })

  test('@smoke marks the current page in the main menu, and only there', async ({ page }) => {
    await page.goto('/about')

    const main = page.getByRole('navigation', { name: 'Main' })
    await expect(main.getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page')
    await expect(main.getByRole('link', { name: 'Staff directory' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  test('@smoke menu links keep the visitor in their language', async ({ page }) => {
    await page.goto('/es/about')

    const main = page.getByRole('navigation', { name: 'Main' })
    await expect(main.getByRole('link', { name: 'Staff directory' })).toHaveAttribute(
      'href',
      '/es/about/staff',
    )
    // Still current: the marker compares unprefixed paths, so it works in every locale.
    await expect(main.getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page')
    // An external destination is not a page of this site and takes no prefix.
    await expect(
      page.getByRole('navigation', { name: 'Quick links' }).getByRole('link'),
    ).toHaveAttribute('href', 'https://outlook.office.com')
  })

  test('@smoke a menu link leads to the page it names — the seeded links all resolve', async ({
    page,
  }) => {
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Staff directory' })
      .click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Staff Directory')
  })
})

test.describe('locale routing', () => {
  test.use(site('a.localhost'))

  test('@smoke serves a Tier 1 locale under its path prefix', async ({ page }) => {
    await page.goto('/es/about')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    // Untranslated until the render-layer pipeline lands (Phase 7, `08` §4) — the locale
    // routing is what is under test here, not the translation.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('About Our School')
  })

  test('@smoke @rtl sets dir="rtl" for Arabic', async ({ page }) => {
    // Release-blocking (`08` §6). Verified from Phase 2 so RTL is never a retrofit.
    await page.goto('/ar')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  })

  test('@smoke emits an hreflang alternate for every enabled locale', async ({ request }) => {
    /**
     * `08` §5 — every locale plus `x-default`, built from the page's RESOLVED path so the
     * alternates point at this page in another language rather than at whatever was typed.
     */
    const { alternates } = await documentFor(request, '/about')

    expect(alternates).toEqual({
      en: '/about',
      es: '/es/about',
      'zh-Hans': '/zh-Hans/about',
      ko: '/ko/about',
      pt: '/pt/about',
      ar: '/ar/about',
      'x-default': '/about',
    })
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
