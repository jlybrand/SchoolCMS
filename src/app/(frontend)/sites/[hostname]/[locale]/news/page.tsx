import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Container } from '@/components/Container'
import { Heading, PAGE_TITLE_LEVEL } from '@/components/Heading'
import { NewsList } from '@/components/NewsList'
import { Stack } from '@/components/Stack'
import { listPosts } from '@/content/posts'
import { collectionTag, tenantTag } from '@/lib/cache-tags'
import { NEWS_PATH, toNewsItems } from '@/lib/post-url'
import { buildPageMetadata, indexingAllowed } from '@/lib/seo'

import { resolveSite, SiteFrame, type SiteParams } from '../site'

/**
 * `/news` — a site's announcements, newest first (Jason, 2026-10-28): its own and those shared
 * with it (`02` §6). A shared one links to its home site, where its page is.
 *
 * Built at revalidate time like every public page (`02` §5); publishing an announcement
 * revalidates every site that lists it (`src/collections/Posts.ts`).
 */
export const revalidate = 3600

/** Enough to read down; more is an archive, which DD2 has not asked for. */
const LIMIT = 50

const TITLE = 'News'

export async function generateMetadata({
  params,
}: {
  params: Promise<SiteParams>
}): Promise<Metadata> {
  const site = await resolveSite(await params)
  if (!site) return {}
  return buildPageMetadata({
    tenant: { name: site.siteName, hostname: site.tenant.hostname },
    page: { title: TITLE, path: NEWS_PATH, body: [], seo: { title: null, description: null } },
    locale: site.ctx.locale,
    locales: site.settings.enabledLocales,
    indexable: indexingAllowed(process.env),
    defaultDescription: site.settings.defaultDescription,
    defaultImage: site.settings.primaryThumbnail,
  })
}

export default async function NewsPage({ params }: { params: Promise<SiteParams> }) {
  const site = await resolveSite(await params)
  if (!site) notFound()

  const items = toNewsItems(await listPosts(site.ctx, { limit: LIMIT }), {
    siteTenantId: site.tenant.id,
    locale: site.ctx.locale,
    serverUrl: process.env.NEXT_PUBLIC_SERVER_URL ?? '',
  })

  return (
    <SiteFrame
      site={site}
      currentPath={NEWS_PATH}
      // Any announcement's change can change this list, its own or a shared one.
      cacheTags={`${tenantTag(site.tenant.id)} ${collectionTag('posts')}`}
    >
      <Container>
        <Stack space="lg">
          <Heading level={PAGE_TITLE_LEVEL}>{TITLE}</Heading>
          <NewsList items={items} level={2} empty="There are no announcements yet." />
        </Stack>
      </Container>
    </SiteFrame>
  )
}
