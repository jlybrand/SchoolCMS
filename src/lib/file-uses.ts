import { relationshipIdOf } from '@/access/predicates'
import { syndicationTargets } from '@/collections/hooks/revalidate-on-publish'
import { pathIndex } from '@/content/page-tree'

/**
 * Where a library file is used (Jason, 2026-11-17) — so an editor sees what a replace or a
 * delete affects. WORKED OUT, NEVER STORED: a library file can be used only by its own site's
 * pages and announcements (`libraryImageField` offers only this site's images, and checks it on
 * save), so its uses are a function of that site's rows and cannot drift out of date.
 *
 * PURE. The caller (`src/admin/Resources/file-uses-data.ts`) passes the file's own site's
 * PUBLISHED pages and announcements only (Jason: published, no drafts), and the published pages
 * on other sites that reuse a district page. Every reference may be an id or a populated doc.
 *
 * Not found, because it isn't stored as a reference: a file's address pasted into text as a link
 * (rich text links only to pages, `src/lib/editor.ts`).
 */

export type UseVia = 'image' | 'hero' | 'document list'

export type FileUsesInput = {
  file: { id: string | number; tenant: unknown; kind: 'image' | 'document' | null; folder: unknown }
  pages: readonly {
    id: string | number
    title?: unknown
    slug?: unknown
    parent?: unknown
    visibility?: unknown
    layout?: unknown
  }[]
  posts: readonly {
    id: string | number
    title?: unknown
    tenant?: unknown
    syndication?: unknown
  }[]
  reusers: readonly {
    id: string | number
    title?: unknown
    tenant?: unknown
    districtLinkTarget?: unknown
  }[]
  /** Tenant id → its name. */
  siteNames: ReadonlyMap<string, string>
  /** Every tenant id, for an announcement shared district-wide. */
  allTenantIds: readonly string[]
}

export type FileUses = {
  pages: {
    id: string | number
    title: string
    /** Its address today, or null when a parent isn't published. */
    path: string | null
    via: UseVia[]
    staffOnly: boolean
  }[]
  announcements: { id: string | number; title: string; alsoOn: string[] }[]
  /** Pages on other sites showing a district page that uses the file (`linkMode: 'reuse'`). */
  linked: { id: string | number; title: string; site: string }[]
}

const VIA_ORDER: readonly UseVia[] = ['hero', 'image', 'document list']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOf = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value !== '' ? value : fallback

/** Every block of a layout, top level and inside Columns. */
const blocksOf = (layout: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(layout)) return []
  return layout.filter(isRecord).flatMap((block) => {
    if (block.blockType !== 'columns') return [block]
    const columns = Array.isArray(block.columns) ? block.columns.filter(isRecord) : []
    return columns.flatMap((column) =>
      Array.isArray(column.content) ? column.content.filter(isRecord) : [],
    )
  })
}

const viaOf = (block: Record<string, unknown>, file: FileUsesInput['file']): UseVia | null => {
  const id = String(file.id)
  if (block.blockType === 'image' || block.blockType === 'hero') {
    return relationshipIdOf(block.image as never) === id ? block.blockType : null
  }
  if (block.blockType === 'documentList' && file.kind === 'document') {
    const folder = relationshipIdOf(file.folder as never)
    return folder !== null && relationshipIdOf(block.folder as never) === folder
      ? 'document list'
      : null
  }
  return null
}

const byTitle = <T extends { title: string }>(rows: T[]): T[] =>
  rows.sort((a, b) => a.title.localeCompare(b.title))

export const findFileUses = (input: FileUsesInput): FileUses => {
  const { file, siteNames } = input
  const paths = pathIndex(
    input.pages.flatMap((p) =>
      typeof p.slug === 'string'
        ? [{ id: p.id, slug: p.slug, parent: (p.parent ?? null) as never }]
        : [],
    ),
  )

  const pages = byTitle(
    input.pages.flatMap((p) => {
      const found = new Set(
        blocksOf(p.layout)
          .map((b) => viaOf(b, file))
          .filter((v) => v !== null),
      )
      if (found.size === 0) return []
      return [
        {
          id: p.id,
          title: textOf(p.title, String(p.id)),
          path: paths.get(String(p.id)) ?? null,
          via: VIA_ORDER.filter((v) => found.has(v)),
          staffOnly: p.visibility !== undefined && p.visibility !== 'public',
        },
      ]
    }),
  )

  const own = relationshipIdOf(file.tenant as never)
  const announcements = byTitle(
    input.posts.map((post) => ({
      id: post.id,
      title: textOf(post.title, String(post.id)),
      alsoOn: syndicationTargets(post, null, input.allTenantIds)
        .filter((t) => t !== own)
        .map((t) => siteNames.get(t) ?? t)
        .sort((a, b) => a.localeCompare(b)),
    })),
  )

  const used = new Set(pages.map((p) => String(p.id)))
  const linked = byTitle(
    input.reusers.flatMap((r) => {
      const target = relationshipIdOf(r.districtLinkTarget as never)
      if (target === null || !used.has(target)) return []
      const site = relationshipIdOf(r.tenant as never)
      return [
        {
          id: r.id,
          title: textOf(r.title, String(r.id)),
          site: site === null ? '' : (siteNames.get(site) ?? site),
        },
      ]
    }),
  )

  return { pages, announcements, linked }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** One line for the replace form. Linked pages are pages too. */
export const usesSummary = (uses: FileUses): string => {
  const pages = uses.pages.length + uses.linked.length
  const announcements = uses.announcements.length
  if (pages === 0 && announcements === 0) return 'Not used on any published page or announcement.'
  const parts = [
    pages > 0 ? count(pages, 'page', 'pages') : null,
    announcements > 0 ? count(announcements, 'announcement', 'announcements') : null,
  ].filter(Boolean)
  return `Used on ${parts.join(' and ')}.`
}
