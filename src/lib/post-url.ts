import type { ImageAsset, Locale, Post } from '@/content/types'
import { DEFAULT_LOCALE, localizedPath } from '@/lib/locales'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'
import { publicUrlFor } from '@/lib/review-emails'
import { excerptOf } from '@/lib/seo'

/**
 * Where an announcement lives, and how its date reads (Jason, 2026-10-28).
 *
 * `/news/{slug}` on its HOME site, and only there. A site it is shared with lists it and links
 * home: one address per announcement means one cached page, one search result, and no clash
 * with a school's own post of the same slug.
 *
 * Pure.
 */

/** The site path of an announcement on its home site. */
export const postPath = (slug: string): string => `/news/${slug}`

/** The site path of the announcement list. */
export const NEWS_PATH = '/news'

/**
 * The link to an announcement from a page of `siteTenantId`.
 *
 * Its own site: a site path in the visitor's language. Another site's: its home site's address,
 * built as the approval email builds one (`publicUrlFor` keeps the server URL's scheme and
 * port, so it works on a developer's machine too), in the default language — whether the home
 * site offers the visitor's is not known here. No home hostname: no link, never a guess.
 */
export const postHref = (
  post: { slug: string; tenantId: string; homeHostname: string | null },
  { siteTenantId, locale, serverUrl }: { siteTenantId: string; locale: Locale; serverUrl: string },
): string | null => {
  if (post.tenantId === siteTenantId) return localizedPath(postPath(post.slug), locale)
  if (!post.homeHostname) return null
  return publicUrlFor(
    serverUrl,
    post.homeHostname,
    localizedPath(postPath(post.slug), DEFAULT_LOCALE),
  )
}

/** The date as a reader says it, in the district's time zone. Null for none or not a date. */
export const formatPostDate = (iso: string | null, locale: Locale): string | null => {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: DISTRICT_TIME_ZONE,
  }).format(date)
}

/** One announcement as a list shows it. Everything already decided; the component only renders. */
export type NewsItem = {
  id: string
  title: string
  /** Null when there is no address to link to (a shared post whose home is not known). */
  href: string | null
  date: { iso: string; label: string } | null
  /** The editor's summary, else the first paragraph, else none. */
  summary: string | null
  /**
   * The announcement's image as a thumbnail, with EMPTY alt text: the headline beside it already
   * says what it is (Jason, 2026-11-13; WCAG 1.1.1). Null when it has none.
   */
  thumbnail: ImageAsset | null
}

export const toNewsItems = (
  posts: readonly Post[],
  where: { siteTenantId: string; locale: Locale; serverUrl: string },
): NewsItem[] =>
  posts.map((post) => {
    const label = formatPostDate(post.publishedDate, where.locale)
    return {
      id: post.id,
      title: post.title,
      href: postHref(post, where),
      date: label && post.publishedDate ? { iso: post.publishedDate, label } : null,
      summary: post.excerpt ?? excerptOf(post.body),
      thumbnail: post.image ? { ...post.image, alt: '' } : null,
    }
  })
