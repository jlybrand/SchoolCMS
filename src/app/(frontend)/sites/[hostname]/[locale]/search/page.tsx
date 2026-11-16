import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Container } from '@/components/Container'
import { Heading, PAGE_TITLE_LEVEL } from '@/components/Heading'
import { Link } from '@/components/Link'
import { SearchForm } from '@/components/SearchForm'
import { SearchResults } from '@/components/SearchResults'
import { Stack } from '@/components/Stack'
import { searchSite } from '@/content/search'
import type { SearchScope } from '@/content/types'
import { tenantTag } from '@/lib/cache-tags'
import { localizedPath } from '@/lib/locales'
import { parseSearchParams, SEARCH_PATH, searchHref } from '@/lib/search'
import { buildPageMetadata, indexingAllowed } from '@/lib/seo'

import { resolveSite, SiteFrame, type SiteParams } from '../site'

import styles from './search.module.css'

/**
 * `/search?q=…` — the site's search results (Jason, 2026-11-16; Phase 6 D).
 *
 * A school searches ITS OWN SITE by default, the district site EVERYTHING; either can switch,
 * by a link that keeps the words. The results come from `searchSite` (the content layer, which
 * scopes the query); this page lays them out.
 *
 * DYNAMIC — it reads the query, so it is rendered per request, never cached — and `noindex`: a
 * results page is not a page for a search engine to list.
 *
 * THE OUTLINE: "Search" is the page's `h1`; each result's title an `h2`. Two search landmarks sit
 * on this page (the header's and this one), named apart.
 */

const TITLE = 'Search'

type Props = {
  params: Promise<SiteParams>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const defaultScopeFor = (type: 'district' | 'school'): SearchScope =>
  type === 'district' ? 'all' : 'site'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = await resolveSite(await params)
  if (!site) return {}
  const metadata = buildPageMetadata({
    tenant: { name: site.siteName, hostname: site.tenant.hostname },
    page: { title: TITLE, path: SEARCH_PATH, body: [], seo: { title: null, description: null } },
    locale: site.ctx.locale,
    locales: site.settings.enabledLocales,
    indexable: indexingAllowed(process.env),
    defaultDescription: site.settings.defaultDescription,
  })
  return { ...metadata, robots: { index: false, follow: true } }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export default async function SearchPage({ params, searchParams }: Props) {
  const site = await resolveSite(await params)
  if (!site) notFound()

  const locale = site.ctx.locale
  const defaultScope = defaultScopeFor(site.tenant.type)
  const request = parseSearchParams(await searchParams, defaultScope)
  const found = await searchSite(site.ctx, request)
  const where = request.scope === 'all' ? 'across all DD2 sites' : `on ${site.siteName}`

  const href = (over: Partial<typeof request>) =>
    searchHref({ ...request, page: 1, ...over }, locale, defaultScope)
  const otherScope: SearchScope = request.scope === 'all' ? 'site' : 'all'
  const otherScopeLabel =
    otherScope === 'all' ? 'Search all DD2 sites' : `Search only ${site.siteName}`

  return (
    <SiteFrame site={site} currentPath={SEARCH_PATH} cacheTags={tenantTag(site.tenant.id)}>
      <Container>
        <Stack space="lg">
          <Heading level={PAGE_TITLE_LEVEL}>{TITLE}</Heading>
          <SearchForm
            action={localizedPath(SEARCH_PATH, locale)}
            id="page-search"
            label={request.scope === 'all' ? 'Search all DD2 sites' : `Search ${site.siteName}`}
            landmark="Search again"
            query={request.query}
            scope={request.scope === defaultScope ? null : request.scope}
            showLabel
          />

          {request.query === null ? (
            <p>Type a word or two, like “enrollment” or “bus routes”.</p>
          ) : (
            <>
              <div className={styles.summary}>
                <p className={styles.count}>
                  {found.total === 0
                    ? `No results for “${request.query}” ${where}.`
                    : `${found.total} ${plural(found.total, 'result', 'results')} for “${request.query}” ${where}.`}
                </p>
                <p>
                  <Link href={href({ scope: otherScope })}>{otherScopeLabel}</Link>
                </p>
              </div>

              {found.results.length > 0 ? (
                <SearchResults
                  level={2}
                  results={found.results}
                  start={(found.page - 1) * 10 + 1}
                />
              ) : null}

              {found.pageCount > 1 ? (
                <nav aria-label="Search result pages" className={styles.pages}>
                  {found.page > 1 ? (
                    <Link href={href({ page: found.page - 1 })}>Previous page</Link>
                  ) : null}
                  <span>
                    Page {found.page} of {found.pageCount}
                  </span>
                  {found.page < found.pageCount ? (
                    <Link href={href({ page: found.page + 1 })}>Next page</Link>
                  ) : null}
                </nav>
              ) : null}
            </>
          )}
        </Stack>
      </Container>
    </SiteFrame>
  )
}
