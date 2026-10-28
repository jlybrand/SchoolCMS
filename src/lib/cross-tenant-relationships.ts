import type { Config } from 'payload'

/**
 * Lets a relationship field marked `custom: { crossTenant: true }` reach other sites' rows.
 *
 * WHY. `plugin-multi-tenant` wraps the `filterOptions` of EVERY relationship that points at a
 * site-scoped collection with "the document's own site only" — in the picker and in server-side
 * validation — and has no per-field opt-out (3.87). That is right almost everywhere: an
 * announcement's own board must be its site's. It is wrong for a news feed, whose job is to show
 * another site's board (Jason, 2026-10-28: SHS's homepage showing District News).
 *
 * WHAT. Runs AFTER the plugin (last in `plugins`) and, on marked fields only, puts back the
 * field's own filter (`custom.filterOptions`) or none. Nothing unmarked is touched.
 *
 * WHY IT IS SAFE for the one field that uses it: the feed is in the district-only `layout`, and a
 * feed only NARROWS what a site can show — each announcement's own sharing decides reach
 * (`feedConstraint`). Picking another site's board shows only what is shared here.
 */

type AnyField = {
  type?: string
  fields?: AnyField[] | undefined
  blocks?: { fields?: AnyField[] | undefined }[]
  tabs?: { fields?: AnyField[] | undefined }[]
  filterOptions?: unknown
  custom?: { crossTenant?: boolean; filterOptions?: unknown }
}

const walk = (fields: AnyField[] | undefined): AnyField[] | undefined =>
  fields?.map((field) => {
    const next: AnyField = { ...field }
    if (next.type === 'relationship' && next.custom?.crossTenant === true) {
      if (next.custom.filterOptions === undefined) delete next.filterOptions
      else next.filterOptions = next.custom.filterOptions
    }
    if (next.fields) next.fields = walk(next.fields)
    if (next.blocks) next.blocks = next.blocks.map((b) => ({ ...b, fields: walk(b.fields) }))
    if (next.tabs) next.tabs = next.tabs.map((t) => ({ ...t, fields: walk(t.fields) }))
    return next
  })

export const crossTenantRelationships = (config: Config): Config =>
  config.collections
    ? {
        ...config,
        collections: config.collections.map((collection) => ({
          ...collection,
          fields: walk(collection.fields as AnyField[]) as typeof collection.fields,
        })),
      }
    : config
