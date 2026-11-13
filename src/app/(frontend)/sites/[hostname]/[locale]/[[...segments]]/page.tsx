import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { BlockList } from '@/blocks'
import { Container } from '@/components/Container'
import { Heading, PAGE_TITLE_LEVEL } from '@/components/Heading'
import { Stack } from '@/components/Stack'
import { getPageByPath } from '@/content/pages'
import { mapBlockLinks } from '@/content/rehome-links'
import { resolvePageBlocks } from '@/content/resolve-blocks'
import type { Page } from '@/content/types'
import { documentTag, tenantTag } from '@/lib/cache-tags'
import { isLocalHost, redirectHref, withLocalPort } from '@/lib/linked-page'
import { buildPageMetadata, indexingAllowed, siteOrigin } from '@/lib/seo'

import { resolveSite, SiteFrame, type Site, type SiteParams } from '../site'

type Params = SiteParams & { segments?: string[] }

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
 * A page's sections render through `BlockList`; its words are Text sections among them (`03` §3).
 */
export const revalidate = 3600

/**
 * The visitor's port, read ONLY for a redirect between two `*.localhost` sites (development and
 * e2e, where they share a port). Reading request headers opts a render out of the cache, so it
 * is never read for a real host — production renders stay cacheable.
 */
const localPort = async (target: string, current: string): Promise<string | null> => {
  if (target === current || !isLocalHost(target) || !isLocalHost(current)) return null
  const host = (await headers()).get('host') ?? ''
  return /:(\d+)$/.exec(host)?.[1] ?? null
}

/**
 * Resolves the tenant and the page for a request, or null if either is missing.
 *
 * Shared by `generateMetadata` and the component so the two cannot disagree about which
 * page they are describing — metadata for one page above a body from another is exactly the
 * kind of mismatch that then gets cached. The duplicate query is affordable because neither
 * caller runs per visitor.
 */
type Resolved = Site & { page: Page }

/** The site (`resolveSite`: unknown host or locale is null), then the page at the path. */
const resolve = async (params: Params): Promise<Resolved | null> => {
  const site = await resolveSite(params)
  if (!site) return null

  const page = await getPageByPath(site.ctx, pathOf(params.segments))
  if (!page) return null

  return { ...site, page }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const resolved = await resolve(await params)
  // The component 404s on the same condition; emitting no metadata is the honest answer for
  // a page that is about to not exist.
  if (!resolved) return {}

  const { tenant, page, settings, siteName } = resolved
  const { locale } = await params

  // A linked page is about to send the visitor elsewhere; it has nothing of its own to describe.
  if (page.redirect) return {}

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

  const { page } = resolved

  /**
   * A LINKED PAGE (Jason, 2026-10-29) sends the visitor on — to a page on this site, or a
   * district page — in their language. Next's `redirect` answers 307: temporary, because the
   * destination is exactly what the district may change, and a browser keeps a permanent one.
   */
  if (page.redirect) {
    redirect(
      redirectHref(
        page.redirect,
        resolved.tenant.hostname,
        resolved.ctx.locale,
        await localPort(page.redirect.hostname, resolved.tenant.hostname),
      ),
    )
  }

  /**
   * Data blocks get their data here (Jason, 2026-10-28): a feed's announcements are loaded by
   * the content layer, never by the block. `BlockList` accepts only resolved blocks, so leaving
   * this out does not compile (`src/content/resolve-blocks.ts`).
   */
  /**
   * REUSED CONTENT (Jason, 2026-10-29) arrives with its links already made district addresses
   * (`src/content/rehome-links.ts`). Between `*.localhost` sites in development, which share a
   * port, they also take the visitor's — never on a real host, so production stays cacheable.
   */
  const port = page.reusedFrom
    ? await localPort(page.reusedFrom.hostname, resolved.tenant.hostname)
    : null
  const rewrite =
    port && page.reusedFrom ? withLocalPort(siteOrigin(page.reusedFrom.hostname), port) : null
  const layout = rewrite ? mapBlockLinks(page.layout, rewrite) : page.layout

  const blocks = await resolvePageBlocks(resolved.ctx, layout, {
    serverUrl: process.env.NEXT_PUBLIC_SERVER_URL ?? '',
  })

  return (
    /**
     * Header, `<main>` and footer come from `SiteFrame` (`../site.tsx`), shared with the
     * announcement routes. Both cache tags are emitted: publishing this page purges its own
     * artifact, and a tenant-wide change (a menu, a theme or a rename) purges every page
     * (`09` §4.2).
     */
    <SiteFrame
      site={resolved}
      currentPath={page.path}
      cacheTags={`${tenantTag(resolved.tenant.id)} ${documentTag('pages', page.id)}`}
      alertPage={{ id: String(page.id), isHome: page.path === '/' }}
    >
      <Container>
        <Stack space="lg">
          {/*
            The page title is the page's only `h1`, owned here rather than by a Text section,
            which is why `RichText` clamps an author's headings to `h2` and below. An editor cannot
            reach the element and therefore cannot produce a heading-order violation
            (`03` §3, `07` §3).
          */}
          <Heading level={PAGE_TITLE_LEVEL}>{page.title}</Heading>

          {/*
            Every page is composed (Jason, 2026-11-04): its words are Text sections among its
            components. `BlockList` renders nothing for an empty layout, and the mapper already
            dropped sections that would have rendered empty.
          */}
          <BlockList blocks={blocks} childPages={page.children} />
        </Stack>
      </Container>
    </SiteFrame>
  )
}
