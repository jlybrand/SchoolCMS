import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

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
    // School B's `settings` rename it, so this is also the site title reaching the tab.
    expect((await documentFor(request, '/')).title).toBe('School B Elementary')
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

test.describe('per-tenant theme (`02` §4.4)', () => {
  const brandOf = (page: Page) =>
    page.evaluate(() => ({
      link: getComputedStyle(document.querySelector('header a') as Element).color,
      rule: getComputedStyle(document.querySelector('header') as Element).borderBlockEndColor,
    }))

  test.describe('a themed tenant', () => {
    test.use(site('a.localhost'))

    test("@smoke renders the school's two colours, and components pick them up unchanged", async ({
      page,
    }) => {
      await page.goto('/about')
      // The link colour is the point: no component was told about the theme.
      expect(await brandOf(page)).toEqual({
        // Main colour: maroon. Second colour: gold, as the rule under the header.
        link: 'rgb(122, 31, 43)',
        rule: 'rgb(201, 162, 39)',
      })
    })
  })

  test.describe('an unthemed tenant', () => {
    test.use(site('b.localhost'))

    test("@smoke renders the default palette — never a neighbour's colour", async ({ page }) => {
      await page.goto('/about')
      expect(await brandOf(page)).toEqual({ link: 'rgb(15, 76, 129)', rule: 'rgb(211, 215, 222)' })
    })
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

    // Absolute, on the TENANT's origin: a crawler has no base URL to resolve against.
    expect(alternates).toEqual({
      en: 'http://a.localhost/about',
      es: 'http://a.localhost/es/about',
      'zh-Hans': 'http://a.localhost/zh-Hans/about',
      ko: 'http://a.localhost/ko/about',
      pt: 'http://a.localhost/pt/about',
      ar: 'http://a.localhost/ar/about',
      'x-default': 'http://a.localhost/about',
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

  test('@smoke the language switcher is site chrome — in the banner, not the page content', async ({
    page,
  }) => {
    await page.goto('/about')
    await expect(
      page.getByRole('banner').getByRole('navigation', { name: 'Language' }),
    ).toHaveCount(1)
    await expect(page.getByRole('main').getByRole('navigation', { name: 'Language' })).toHaveCount(
      0,
    )
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

test.describe('per-tenant settings (`03` §5)', () => {
  test.describe('a tenant with contact details and every language', () => {
    test.use(site('a.localhost'))

    test('@smoke the footer carries the contact block and the social links', async ({ page }) => {
      await page.goto('/es/about')
      const footer = page.getByRole('contentinfo')

      await expect(footer.locator('address')).toContainText('100 School A Road')
      // Never locale-prefixed, on a Spanish page: neither is a path on this site.
      await expect(footer.getByRole('link', { name: '(843) 555-0100' })).toHaveAttribute(
        'href',
        'tel:8435550100',
      )
      await expect(footer.getByRole('link', { name: 'office@a.localhost' })).toHaveAttribute(
        'href',
        'mailto:office@a.localhost',
      )
      await expect(
        footer.getByRole('navigation', { name: 'Social media' }).getByRole('link'),
      ).toHaveText(['Facebook', 'YouTube'])
    })
  })

  test.describe('a tenant that offers Spanish only', () => {
    test.use(site('b.localhost'))

    test('@smoke its name is the one its settings give it, everywhere the site names itself', async ({
      page,
    }) => {
      await page.goto('/about')
      await expect(
        page.getByRole('banner').getByRole('link', { name: 'School B Elementary' }),
      ).toHaveAttribute('href', '/')
      await expect(page.getByRole('contentinfo')).toContainText('School B Elementary')
    })

    test('@smoke a language it has not enabled is not a page', async ({ request }) => {
      // The proxy recognises `/ar` for every tenant; the tenant's own list decides (`08` §2).
      expect((await request.get('/es/about')).status()).toBe(200)
      expect((await request.get('/ar/about')).status()).toBe(404)
      expect((await request.get('/ko')).status()).toBe(404)
    })

    test('@smoke hreflang, the switcher and the sitemap all read the same list', async ({
      page,
      request,
    }) => {
      expect((await documentFor(request, '/about')).alternates).toEqual({
        en: 'http://b.localhost/about',
        es: 'http://b.localhost/es/about',
        'x-default': 'http://b.localhost/about',
      })

      await page.goto('/about')
      await expect(page.getByRole('navigation', { name: 'Language' }).getByRole('link')).toHaveText(
        ['English', 'Español'],
      )

      const xml = await (await request.get('/sitemap.xml')).text()
      expect(xml).toContain('<loc>http://b.localhost/es/about</loc>')
      expect(xml).not.toContain('/ar/')
    })
  })
})

test.describe('search engines and link previews (`01` §3 item 13)', () => {
  test.describe('on one tenant', () => {
    test.use(site('a.localhost'))

    test('@smoke a page describes itself without anyone having written SEO fields', async ({
      request,
    }) => {
      const html = await (await request.get('/es/about')).text()
      const meta = (name: string) =>
        new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)"`).exec(html)?.[1]

      // The description falls back to the first paragraph of the body.
      expect(meta('description')).toBe('A seeded top-level page, so path walking has a target.')
      expect(meta('og:title')).toBe('About Our School — School A')
      expect(meta('og:site_name')).toBe('School A')
      expect(meta('og:url')).toBe('http://a.localhost/es/about')
      expect(/<link rel="canonical" href="([^"]+)"/.exec(html)?.[1]).toBe(
        'http://a.localhost/es/about',
      )
    })

    test('@smoke robots.txt names this tenant’s sitemap and keeps crawlers out of the admin', async ({
      request,
    }) => {
      const response = await request.get('/robots.txt')
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('text/plain')

      const body = await response.text()
      expect(body).toContain('Disallow: /admin')
      expect(body).toContain('Sitemap: http://a.localhost/sitemap.xml')
    })

    test('@smoke sitemap.xml lists every reachable page in every locale, and only those', async ({
      request,
    }) => {
      const response = await request.get('/sitemap.xml')
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('application/xml')

      const xml = await response.text()
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

      // 3 seeded pages x 6 locales. The front page is `/`, never `/home`.
      expect(locs).toHaveLength(18)
      expect(locs).toContain('http://a.localhost/')
      expect(locs).toContain('http://a.localhost/ar/about/staff')
      expect(locs.some((loc) => loc?.includes('/home'))).toBe(false)
      // Every URL is this tenant's.
      expect(locs.every((loc) => loc?.startsWith('http://a.localhost/'))).toBe(true)
    })

    test('@smoke every sitemap URL is one the site actually serves', async ({ request }) => {
      const xml = await (await request.get('/sitemap.xml')).text()
      const paths = [...xml.matchAll(/<loc>http:\/\/a\.localhost([^<]*)<\/loc>/g)].map(
        (match) => match[1] ?? '/',
      )

      for (const path of paths) {
        expect((await request.get(path)).status(), path).toBe(200)
      }
    })

    test("@smoke another tenant's sitemap cannot be read by naming the rewrite target", async ({
      request,
    }) => {
      // Both the real targets and an extension-suffixed spelling the general matcher skips.
      for (const path of ['sitemap', 'robots', 'sitemap.xml', 'robots.txt']) {
        expect((await request.get(`/sites/b.localhost/${path}`)).status(), path).toBe(404)
      }
    })
  })

  test.describe('on a second tenant', () => {
    test.use(site('b.localhost'))

    test('@smoke the same URL gives that tenant’s answer', async ({ request }) => {
      expect(await (await request.get('/robots.txt')).text()).toContain(
        'Sitemap: http://b.localhost/sitemap.xml',
      )
      const xml = await (await request.get('/sitemap.xml')).text()
      expect(xml).toContain('<loc>http://b.localhost/about</loc>')
      expect(xml).not.toContain('a.localhost')
    })
  })

  test.describe('on an unknown host', () => {
    test.use(site('unknown.localhost'))

    test('@smoke there is no site to describe', async ({ request }) => {
      expect((await request.get('/robots.txt')).status()).toBe(404)
      expect((await request.get('/sitemap.xml')).status()).toBe(404)
    })
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
