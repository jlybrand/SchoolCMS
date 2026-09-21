import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BlockList } from '@/blocks'
import { Container } from '@/components/Container'
import { Heading, PAGE_TITLE_LEVEL } from '@/components/Heading'
import { Link } from '@/components/Link'
import { RichText } from '@/components/RichText'
import { SiteFooter } from '@/components/SiteFooter'
import { SiteHeader } from '@/components/SiteHeader'
import { MAIN_CONTENT_ID } from '@/components/SkipLink'
import { Stack } from '@/components/Stack'
import { getNavigation } from '@/content/navigation'
import { getPageByPath } from '@/content/pages'
import { getSettings } from '@/content/settings'
import { getTenantByHostname } from '@/content/tenants'
import type { ContentContext, Navigation, Page, SiteSettings, Tenant } from '@/content/types'
import { documentTag, tenantTag } from '@/lib/cache-tags'
import { LOCALE_NAMES, localizedPath } from '@/lib/locales'
import { buildPageMetadata, indexingAllowed } from '@/lib/seo'

type Params = { hostname: string; locale: string; segments?: string[] }

const pathOf = (segments: string[] | undefined) => `/${(segments ?? []).join('/')}`

/**
 * Public page (`02` §5).
 *
 * Availability model: the tenant and page lookups run at build/revalidate time, never per
 * visitor. Visitors are served cached static/ISR artifacts from the edge, so an admin or
 * database outage pauses *publishing*, never *serving* (`00` principle 3, `02` §5).
 *
 * Note what is absent: no Payload import. Content comes through `src/content/*`, which
 * returns DD2 domain types (`02` §11, ADR-5). The renderer never learns what a Lexical node
 * is — `src/content/rich-text.ts` already turned those into DD2 nodes.
 *
 * The `composed` layout renders through `BlockList`, which slots in beside `RichText`
 * without changing the routing or caching shape (`03` §3).
 */
export const revalidate = 3600

/**
 * Resolves the tenant and the page for a request, or null if either is missing.
 *
 * Shared by `generateMetadata` and the component so the two cannot disagree about which
 * page they are describing — metadata for one page above a body from another is exactly the
 * kind of mismatch that then gets cached. The duplicate query is affordable because neither
 * caller runs per visitor.
 */
type Resolved = {
  tenant: Tenant
  page: Page
  ctx: ContentContext
  settings: SiteSettings
  /** `settings.siteTitle`, else the tenant's name — decided once, for the tab and the chrome. */
  siteName: string
}

const resolve = async (params: Params): Promise<Resolved | null> => {
  const tenant = await getTenantByHostname(decodeURIComponent(params.hostname))
  if (!tenant) return null

  /**
   * A locale this tenant has not enabled is NOT A PAGE (`03` §5, `08` §2). The proxy runs at
   * the edge, where there is no database, so it recognises every platform locale and the
   * per-tenant answer is given here — a 404, the same one an unknown path gets. Without it
   * `/ar/about` would render on a site that offers no Arabic, outside `hreflang`, the
   * sitemap and the language switcher, which all read the same list.
   *
   * A tenant with no `settings` row gets every platform locale, never null.
   */
  const settings = await getSettings({ tenant })
  if (!settings.enabledLocales.includes(params.locale)) return null

  const ctx: ContentContext = { tenant, locale: params.locale }

  const page = await getPageByPath(ctx, pathOf(params.segments))
  if (!page) return null

  return { tenant, page, ctx, settings, siteName: settings.siteTitle ?? tenant.name }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const resolved = await resolve(await params)
  // The component 404s on the same condition; emitting no metadata is the honest answer for
  // a page that is about to not exist.
  if (!resolved) return {}

  const { tenant, page, settings, siteName } = resolved
  const { locale } = await params

  /**
   * Assembled by a pure function (`src/lib/seo.ts`) — the title rule, the description
   * fallback, absolute canonical and `hreflang` URLs (`08` §5), Open Graph, and `noindex`
   * everywhere indexing has not been explicitly allowed. This file's job is to hand it the
   * page; what the tags say is decided, and tested, there.
   */
  return buildPageMetadata({
    tenant: { name: siteName, hostname: tenant.hostname },
    page,
    locale,
    locales: settings.enabledLocales,
    indexable: indexingAllowed(process.env),
    defaultDescription: settings.defaultDescription,
  })
}

export default async function SitePage({ params }: { params: Promise<Params> }) {
  const resolved = await resolve(await params)

  /**
   * An unknown host, and an unknown path within a known host, both 404.
   *
   * The host case is the one with teeth: it is NEVER served a default tenant's content —
   * that would put one school's pages on another school's domain, and no access function
   * would catch it because the mistake happens before any scoping (`02` §4.1).
   *
   * The path case matters for a quieter reason. `getPageByPath` returns null for a draft and
   * for a staff-only page as well as for a missing one, so all three land here and 404
   * identically. A "this page is not published yet" message would leak the existence and
   * title of unpublished content to anyone guessing URLs (`03` §6.4).
   */
  if (!resolved) notFound()

  const { tenant, page, ctx, settings, siteName } = resolved

  /**
   * Fetched only once the page is known to exist, so a 404 costs no menu query. Not in
   * `resolve`, which `generateMetadata` shares: metadata has no use for the menus.
   *
   * A tenant with no `navigation` row gets three empty menus, never null — so there is no
   * missing-data branch below, and a site created today renders a header with its name in it.
   */
  const navigation: Navigation = await getNavigation(ctx)

  return (
    /**
     * THE HEADER AND FOOTER ARE RENDERED HERE, NOT IN THE LAYOUT, because the layout cannot
     * see `segments`: it would render the menus without knowing which page they are on, and
     * `aria-current` is the one thing a menu owes a screen-reader user. They are siblings of
     * `<main>` directly under `<body>`, which is what makes them the banner and contentinfo
     * landmarks; the skip link, in the layout, still comes first.
     *
     * The tenant cache tag on `<main>` covers them: a menu change is a tenant-wide change,
     * and it purges every page of the site (`09` §4.2).
     */
    <>
      <SiteHeader
        siteName={siteName}
        primary={navigation.primary}
        utility={navigation.utility}
        currentPath={page.path}
        locale={ctx.locale}
      />
      {/*
        `id` comes from the `SkipLink` module rather than a literal, so the bypass-blocks
        target cannot be renamed out from under the link (`07` §3). The measure and gutters
        come from `Container` — the single owner of both, in logical properties.

        Both cache tags are emitted: publishing this page purges its own artifact, and a
        tenant-wide change (a menu, a theme or a rename) purges every page (`09` §4.2).
      */}
      <main
        data-cache-tag={`${tenantTag(tenant.id)} ${documentTag('pages', page.id)}`}
        id={MAIN_CONTENT_ID}
      >
        <Container>
          <Stack space="lg">
            {/*
            The page title is the page's only `h1`, owned here rather than by the body, which
            is why `RichText` clamps an author's headings to `h2` and below. An editor cannot
            reach the element and therefore cannot produce a heading-order violation
            (`03` §3, `07` §3).
          */}
            <Heading level={PAGE_TITLE_LEVEL}>{page.title}</Heading>

            <RichText content={page.body} />

            {/*
            NO BRANCH ON `pageType`. Both renderers return null when they have nothing:
            `RichText` for an empty body, `BlockList` for an empty layout — and the mapper
            already dropped blocks that would have rendered empty. A fixed-type page
            therefore renders prose and no layout, and a composed page renders its layout,
            without this template knowing which it is holding.

            That matters beyond tidiness: when school-level composition stops being a
            deferred add-on (`01` §4.1), it is an access-predicate change and nothing here
            moves (`03` §2).
          */}
            <BlockList blocks={page.layout} childPages={page.children} />

            {/* One language is not a choice: English-only sites get no switcher. */}
            {settings.enabledLocales.length > 1 && (
              <nav aria-label="Language">
                {/*
              `08` §6 — each language is listed in its OWN script and language, with `lang` on
              each link. Never flag icons (a flag is a country, not a language) and never
              "translate this page" as the only affordance. Labels stay untranslated here
              deliberately; that is what a language switcher is for.

              Built from the page's resolved path rather than the requested one, so the
              switcher always points at this page in another language.
            */}
                <ul>
                  {settings.enabledLocales.map((code) => (
                    <li key={code}>
                      <Link href={localizedPath(page.path, code)} hrefLang={code} lang={code}>
                        {LOCALE_NAMES[code] ?? code}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </Stack>
        </Container>
      </main>
      <SiteFooter
        siteName={siteName}
        links={navigation.footer}
        contact={settings.contact}
        social={settings.social}
        currentPath={page.path}
        locale={ctx.locale}
      />
    </>
  )
}
