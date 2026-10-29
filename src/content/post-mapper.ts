import { relationshipIdOf, tenantIdOf } from '@/access/predicates'

import { NO_PAGE_PATHS, type PagePaths } from './page-tree'
import { toRichText } from './rich-text'
import type { Post } from './types'

/**
 * A Payload `posts` row to a DD2 `Post` (`02` §11). Pure, so the Phase 9 migration mappers can
 * run it with no CMS (`10` §5).
 *
 * Returns null for a row it cannot use — no id, tenant, title or slug — and the caller drops it.
 * Nothing about review or syndication crosses: the renderer is handed what to show, never how
 * it got there.
 */

const text = (value: unknown): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed === '' ? null : trimmed
}

/**
 * `paths` is the post's HOME site's page id -> current path, for links to a page in its words
 * (Jason, 2026-10-29). Only `getPostBySlug` passes it — it is the one caller that renders the
 * body, and it renders it on the home site, where those paths are.
 */
export const toPost = (row: unknown, paths: PagePaths = NO_PAGE_PATHS): Post | null => {
  if (typeof row !== 'object' || row === null) return null
  const doc = row as Record<string, unknown>

  const id = doc.id === undefined || doc.id === null ? null : String(doc.id)
  const tenantId = tenantIdOf(doc.tenant as never)
  const title = text(doc.title)
  const slug = text(doc.slug)
  if (id === null || tenantId === null || title === null || slug === null) return null

  return {
    id,
    tenantId,
    title,
    slug,
    excerpt: text(doc.excerpt),
    body: toRichText(doc.body, paths),
    publishedDate: text(doc.publishedDate),
    boardId: relationshipIdOf(doc.board as never),
    tagIds: Array.isArray(doc.tags)
      ? doc.tags.map((t) => relationshipIdOf(t as never)).filter((t): t is string => t !== null)
      : [],
    // Filled by the content layer, which reads the tenants; this mapper is pure.
    homeHostname: null,
  }
}
