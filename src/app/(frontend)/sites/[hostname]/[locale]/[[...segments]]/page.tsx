import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BlockList } from '@/blocks'
import { Container } from '@/components/Container'
import { Heading, PAGE_TITLE_LEVEL } from '@/components/Heading'
import { Link } from '@/components/Link'
import { RichText } from '@/components/RichText'
import { MAIN_CONTENT_ID } from '@/components/SkipLink'
import { Stack } from '@/components/Stack'
import { getPageByPath } from '@/content/pages'
import { getTenantByHostname } from '@/content/tenants'
import type { ContentContext, Page, Tenant } from '@/content/types'
import { documentTag, tenantTag } from '@/lib/cache-tags'
import { ALL_LOCALES, hreflangAlternates, localizedPath } from '@/lib/locales'

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
const resolve = async (params: Params): Promise<{ tenant: Tenant; page: Page } | null> => {
  const tenant = await getTenantByHostname(decodeURIComponent(params.hostname))
  if (!tenant) return null

  const ctx: ContentContext = { tenant, locale: params.locale }

  const page = await getPageByPath(ctx, pathOf(params.segments))
  if (!page) return null

  return { tenant, page }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const resolved = await resolve(await params)
  // The component 404s on the same condition; emitting no metadata is the honest answer for
  // a page that is about to not exist.
  if (!resolved) return {}

  const { tenant, page } = resolved
  const { locale } = await params

  return {
    /**
     * The front page is titled with the site's name. Its `title` field is an internal label
     * ("Home") that names the row for editors, not the site — putting it in the browser tab
     * and the search result would describe 28 sites identically.
     */
    title: page.path === '/' ? tenant.name : `${page.title} — ${tenant.name}`,
    alternates: {
      canonical: localizedPath(page.path, locale),
      // `08` §5 — alternates for every enabled locale plus x-default.
      languages: Object.fromEntries(
        hreflangAlternates(page.path).map(({ hrefLang, href }) => [hrefLang, href]),
      ),
    },
  }
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

  const { tenant, page } = resolved

  return (
    /**
     * `id` comes from the `SkipLink` module rather than a literal, so the bypass-blocks
     * target cannot be renamed out from under the link (`07` §3). The measure and gutters
     * come from `Container` — the single owner of both, in logical properties.
     *
     * Both cache tags are emitted: publishing this page purges its own artifact, and a
     * tenant-wide change (a theme or a rename) purges every page (`09` §4.2).
     */
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
          <BlockList blocks={page.layout} />

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
              {ALL_LOCALES.map((code) => (
                <li key={code}>
                  <Link href={localizedPath(page.path, code)} hrefLang={code} lang={code}>
                    {LANGUAGE_NAMES[code] ?? code}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Stack>
      </Container>
    </main>
  )
}

/** Endonyms — each language named as its own speakers write it (`08` §6). */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Español',
  'zh-Hans': '简体中文',
  ko: '한국어',
  pt: 'Português',
  ar: 'العربية',
}
