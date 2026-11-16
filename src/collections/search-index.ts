import { searchPlugin } from '@payloadcms/plugin-search'
import type { Payload } from 'payload'

import { toSearchEntry, type SearchCollection } from '@/content/search-entry'

/**
 * The SITE SEARCH INDEX (Jason, 2026-11-16; Phase 6 D; ADR-14 Postgres FTS).
 *
 * `@payloadcms/plugin-search` keeps one `search` row per published page, announcement, event and
 * library file, in step with them: written when one is published, removed when it is unpublished
 * or deleted. Adopted rather than rebuilt (CLAUDE.md: nothing bespoke where Payload provides it);
 * its data is one plain table, so the swap cost is small. Its own `like` search is not used —
 * `src/content/search.ts` runs Postgres full-text search over the table.
 *
 * - WHAT each row holds is `toSearchEntry` (`src/content/search-entry.ts`, pure). An entry that
 *   must not be found is written `excluded` rather than skipped: the plugin's `skipSync` never
 *   removes an entry already there, so a live announcement switched to staff-only would stay.
 * - NOBODY READS IT THROUGH THE API. Every route's access is closed; the plugin writes as the
 *   platform and the content layer reads with access overridden, scoped in its own query.
 * - NOT registered with the tenant plugin: hidden and unreadable, it needs no admin scoping, and
 *   the query filters by `tenant` itself. A site cannot be deleted while it has content, and
 *   deleting content removes its entries, so a deleted site leaves none.
 */

const COLLECTIONS: SearchCollection[] = ['pages', 'posts', 'events', 'resources']

const closed = () => false

/** An index row's own fields for a document — what `beforeSync` and the backfill both write. */
const entryFields = (collection: SearchCollection, doc: Record<string, unknown>) => {
  const entry = toSearchEntry(collection, doc)
  // Postgres ids are integers; the relationship refuses the string form the pure mapper uses.
  return { ...entry, tenant: entry.tenant === null ? null : Number(entry.tenant) }
}

export const siteSearch = searchPlugin({
  collections: COLLECTIONS,
  beforeSync: ({ collectionSlug, originalDoc, searchDoc }) => ({
    ...searchDoc,
    ...entryFields(collectionSlug as SearchCollection, originalDoc as Record<string, unknown>),
  }),
  searchOverrides: {
    slug: 'search',
    labels: { singular: 'Search entry', plural: 'Search index' },
    access: { read: closed, create: closed, update: closed, delete: closed },
    admin: { hidden: true },
    fields: ({ defaultFields }) => [
      ...defaultFields,
      { name: 'tenant', type: 'relationship', relationTo: 'tenants', index: true },
      { name: 'kind', type: 'text', index: true },
      { name: 'text', type: 'textarea' },
      { name: 'excluded', type: 'checkbox', defaultValue: false, index: true },
      { name: 'reachAll', type: 'checkbox', defaultValue: false },
      { name: 'reachSites', type: 'json' },
      { name: 'lastDate', type: 'date' },
      { name: 'href', type: 'text' },
    ],
  },
})

/**
 * THE BACKFILL (`pnpm search:reindex`, 2026-11-16): rebuilds the whole index from what is
 * published now — for content published before the index existed (`dd2_dev`; production once, at
 * the deploy that brings search). The plugin's own reindex endpoint stays shut: it checks access to
 * the index, which nobody has.
 *
 * Written directly, not by re-saving each document: a save would fire the audit log, revalidation
 * and review state for nothing. Safe to re-run — it clears the index first. Returns how many of
 * each it indexed.
 */
export const reindexSearch = async (
  payload: Payload,
): Promise<Record<SearchCollection, number>> => {
  const counts = { pages: 0, posts: 0, events: 0, resources: 0 }
  await payload.delete({ collection: 'search', where: {}, overrideAccess: true })
  for (const collection of COLLECTIONS) {
    const published = collection === 'resources' ? {} : { _status: { equals: 'published' } }
    let page = 1
    for (;;) {
      const batch = await payload.find({
        collection,
        where: published as never,
        draft: false,
        depth: 0,
        limit: 100,
        page,
        overrideAccess: true,
      })
      for (const doc of batch.docs as unknown as Record<string, unknown>[]) {
        await payload.create({
          collection: 'search',
          data: {
            doc: { relationTo: collection, value: doc.id },
            ...entryFields(collection, doc),
          } as never,
          depth: 0,
          overrideAccess: true,
        })
        counts[collection] += 1
      }
      if (!batch.hasNextPage) break
      page += 1
    }
  }
  return counts
}
