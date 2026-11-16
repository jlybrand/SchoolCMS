import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { LibraryImage } from '@/blocks/LibraryImage'
import { Container } from '@/components/Container'
import { Heading, PAGE_TITLE_LEVEL } from '@/components/Heading'
import { Link } from '@/components/Link'
import { PublishedDate } from '@/components/PublishedDate'
import { RichText } from '@/components/RichText'
import { Stack } from '@/components/Stack'
import { getPostBySlug } from '@/content/posts'
import { documentTag, tenantTag } from '@/lib/cache-tags'
import { localizedPath } from '@/lib/locales'
import { formatPostDate, NEWS_PATH, postPath } from '@/lib/post-url'
import { buildPageMetadata, indexingAllowed } from '@/lib/seo'

import { resolveSite, SiteFrame, type SiteParams } from '../../site'

/**
 * `/news/{slug}` — one announcement, on its HOME site only (Jason, 2026-10-28). A site it is
 * shared with lists it and links here: one address, one cached page, one search result.
 *
 * A draft, a staff-only announcement, another site's and a missing one all 404 alike — a "not
 * published yet" message would tell a URL-guesser it exists (`03` §6.4).
 */
export const revalidate = 3600

type Params = SiteParams & { slug: string }

const resolve = async (params: Params) => {
  const site = await resolveSite(params)
  if (!site) return null
  const post = await getPostBySlug(site.ctx, decodeURIComponent(params.slug))
  return post ? { site, post } : null
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const resolved = await resolve(await params)
  if (!resolved) return {}
  const { site, post } = resolved
  return buildPageMetadata({
    tenant: { name: site.siteName, hostname: site.tenant.hostname },
    page: {
      title: post.title,
      path: postPath(post.slug),
      body: post.body,
      // The editor's summary is what it says it is; without one, the first paragraph is used.
      seo: { title: null, description: post.excerpt },
    },
    locale: site.ctx.locale,
    locales: site.settings.enabledLocales,
    indexable: indexingAllowed(process.env),
    defaultDescription: site.settings.defaultDescription,
  })
}

export default async function PostPage({ params }: { params: Promise<Params> }) {
  const resolved = await resolve(await params)
  if (!resolved) notFound()
  const { site, post } = resolved
  const date = formatPostDate(post.publishedDate, site.ctx.locale)

  return (
    <SiteFrame
      site={site}
      currentPath={postPath(post.slug)}
      cacheTags={`${tenantTag(site.tenant.id)} ${documentTag('posts', post.id)}`}
    >
      <Container>
        <Stack space="lg">
          <Stack space="xs">
            {/* The headline is the page's only `h1`; `RichText` clamps the body to h2 and below. */}
            <Heading level={PAGE_TITLE_LEVEL}>{post.title}</Heading>
            {date && post.publishedDate ? (
              <PublishedDate iso={post.publishedDate} label={date} />
            ) : null}
          </Stack>
          {/* Its image (Jason, 2026-11-13), under the headline, with the library's alt text. */}
          {post.image ? (
            <LibraryImage
              block={{ kind: 'image', id: 'post-image', image: post.image, caption: null }}
              priority
            />
          ) : null}
          <RichText content={post.body} />
          <p>
            <Link href={localizedPath(NEWS_PATH, site.ctx.locale)}>All news</Link>
          </p>
        </Stack>
      </Container>
    </SiteFrame>
  )
}
