import { describe, expect, it } from 'vitest'

import { documentTag, localeTag, tagsForDocument, tenantTag } from '@/lib/cache-tags'

/**
 * Cache tags (`09` §4.2, `02` §5–6).
 *
 * Publishing triggers on-demand revalidation plus a targeted purge, so content goes live in
 * seconds while everything else stays warm. Tags are keyed by document id, tenant, AND
 * locale — the locale axis matters because a Tier 1 variant is a separate cached artifact,
 * and purging only the English URL would leave five stale translations live (`08` §5).
 *
 * Tags must be stable and collision-free: a collision either over-purges (losing the
 * warm-cache benefit) or under-purges (serving stale content, which on a closure day is a
 * safety problem, not a cosmetic one).
 */

describe('tag construction', () => {
  it('namespaces each tag kind so ids from different axes cannot collide', () => {
    // Without namespacing, tenant "42" and document "42" would purge each other.
    expect(tenantTag('42')).not.toBe(documentTag('posts', '42'))
    expect(documentTag('posts', '42')).not.toBe(documentTag('events', '42'))
  })

  it('is stable across string and numeric ids', () => {
    // Postgres issues numeric ids; a hook may receive either form.
    expect(tenantTag(42)).toBe(tenantTag('42'))
    expect(documentTag('posts', 7)).toBe(documentTag('posts', '7'))
  })

  it('produces readable tags', () => {
    expect(tenantTag('summerville')).toBe('tenant:summerville')
    expect(documentTag('posts', '7')).toBe('posts:7')
    expect(localeTag('es')).toBe('locale:es')
  })
})

describe('tagsForDocument', () => {
  it('tags the document, its tenant, and its collection', () => {
    const tags = tagsForDocument({ collection: 'posts', id: '7', tenantId: 't1', locales: ['en'] })

    expect(tags).toContain('posts:7')
    expect(tags).toContain('tenant:t1')
    expect(tags).toContain('collection:posts')
  })

  it('emits a tag per locale so every variant is purged', () => {
    const tags = tagsForDocument({
      collection: 'posts',
      id: '7',
      tenantId: 't1',
      locales: ['en', 'es', 'ar'],
    })

    expect(tags).toContain('posts:7:en')
    expect(tags).toContain('posts:7:es')
    expect(tags).toContain('posts:7:ar')
  })

  it('tags every syndicated tenant — the COPE fan-out', () => {
    /**
     * `02` §6 — a district post referenced by school tenants must purge EVERY surface that
     * renders it. Missing one is the failure mode where an edit appears on the district
     * site but not on the schools showing the same item.
     */
    const tags = tagsForDocument({
      collection: 'posts',
      id: '7',
      tenantId: 'district',
      syndicatedTo: ['school-a', 'school-b'],
      locales: ['en'],
    })

    expect(tags).toContain('tenant:district')
    expect(tags).toContain('tenant:school-a')
    expect(tags).toContain('tenant:school-b')
  })

  it('deduplicates when a syndication target repeats the owning tenant', () => {
    const tags = tagsForDocument({
      collection: 'posts',
      id: '7',
      tenantId: 't1',
      syndicatedTo: ['t1', 't1', 't2'],
      locales: ['en'],
    })

    expect(tags.filter((t) => t === 'tenant:t1')).toHaveLength(1)
    expect(new Set(tags).size).toBe(tags.length)
  })

  it('defaults to the source locale when none is supplied', () => {
    const tags = tagsForDocument({ collection: 'pages', id: '1', tenantId: 't1' })
    expect(tags).toContain('pages:1:en')
  })

  it('never emits an empty or malformed tag', () => {
    // An empty tag would purge nothing or, worse, match broadly at the CDN.
    const tags = tagsForDocument({
      collection: 'pages',
      id: '1',
      tenantId: '',
      syndicatedTo: ['', 'ok'],
      locales: ['', 'es'],
    })

    for (const tag of tags) {
      expect(tag).not.toBe('')
      expect(tag.endsWith(':')).toBe(false)
      expect(tag).not.toContain('::')
    }
    expect(tags).toContain('tenant:ok')
  })
})
