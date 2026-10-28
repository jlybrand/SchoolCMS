import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { crossTenantRelationships } from '@/lib/cross-tenant-relationships'

/**
 * `plugin-multi-tenant` gives EVERY relationship to a site-scoped collection a "this site only"
 * filter, with no opt-out. A news feed must pick other sites' boards (Jason, 2026-10-28: SHS's
 * homepage shows District News), so a field marked `custom.crossTenant` gets its own filter back.
 * Runs after the plugin; nothing unmarked is touched.
 */

const pluginFilter = () => ({ tenant: { in: [1] } })

const configWith = (fields: unknown[]): Config =>
  ({ collections: [{ slug: 'pages', fields }] }) as unknown as Config

const field = (marked: boolean, original?: unknown) => ({
  name: 'boards',
  type: 'relationship',
  relationTo: 'post-boards',
  filterOptions: pluginFilter,
  custom: marked ? { crossTenant: true, ...(original ? { filterOptions: original } : {}) } : {},
})

const run = (fields: unknown[]) =>
  (
    crossTenantRelationships(configWith(fields)) as unknown as {
      collections: { fields: unknown[] }[]
    }
  ).collections[0]!.fields

describe('crossTenantRelationships', () => {
  it('drops the plugin’s filter from a marked field', () => {
    const [out] = run([field(true)]) as { filterOptions?: unknown }[]
    expect(out!.filterOptions).toBeUndefined()
  })

  it('restores the field’s own filter, if it had one', () => {
    const own = () => ({ name: { exists: true } })
    const [out] = run([field(true, own)]) as { filterOptions?: unknown }[]
    expect(out!.filterOptions).toBe(own)
  })

  it('leaves an unmarked relationship to the plugin', () => {
    const [out] = run([field(false)]) as { filterOptions?: unknown }[]
    expect(out!.filterOptions).toBe(pluginFilter)
  })

  it('finds a marked field inside a block inside a blocks field', () => {
    const [layout] = run([
      { name: 'layout', type: 'blocks', blocks: [{ slug: 'feed', fields: [field(true)] }] },
    ]) as { blocks: { fields: { filterOptions?: unknown }[] }[] }[]
    expect(layout!.blocks[0]!.fields[0]!.filterOptions).toBeUndefined()
  })
})
