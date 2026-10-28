import { describe, expect, it } from 'vitest'

import { toPost } from '@/content/post-mapper'

/**
 * The posts mapper (`03` §2, `02` §11) — a Payload `posts` row to a DD2 `Post`.
 *
 * Handed `unknown`. A row it cannot use is `null`, and the caller drops it: a feed with one
 * announcement missing is a smaller failure than a feed that does not render.
 */

const paragraph = (text: string) => ({
  root: {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', text, format: 0 }] }],
  },
})

describe('toPost', () => {
  it('maps a complete row', () => {
    expect(
      toPost({
        id: 12,
        tenant: { id: 3, name: 'District' },
        title: ' Picture day ',
        slug: 'picture-day',
        excerpt: ' Wear a smile. ',
        body: paragraph('Thursday.'),
        publishedDate: '2026-10-01T12:00:00.000Z',
        syndication: { scope: 'district-wide' },
        reviewState: 'submitted',
      }),
    ).toEqual({
      id: '12',
      tenantId: '3',
      title: 'Picture day',
      slug: 'picture-day',
      excerpt: 'Wear a smile.',
      body: [{ kind: 'paragraph', children: [{ kind: 'text', text: 'Thursday.', marks: [] }] }],
      publishedDate: '2026-10-01T12:00:00.000Z',
    })
  })

  it('reads an empty or whitespace summary as none', () => {
    expect(toPost({ id: 1, tenant: 3, title: 'T', slug: 't', excerpt: '  ' })?.excerpt).toBeNull()
  })

  it('a missing body is an empty one, and a missing date is null', () => {
    expect(toPost({ id: 1, tenant: 3, title: 'T', slug: 't' })).toMatchObject({
      body: [],
      publishedDate: null,
    })
  })

  it.each([
    ['no id', { tenant: 3, title: 'T', slug: 't' }],
    ['no tenant', { id: 1, title: 'T', slug: 't' }],
    ['no title', { id: 1, tenant: 3, title: ' ', slug: 't' }],
    ['no slug', { id: 1, tenant: 3, title: 'T' }],
    ['not an object', 'post'],
  ])('drops a row with %s', (_label, row) => {
    expect(toPost(row)).toBeNull()
  })
})
