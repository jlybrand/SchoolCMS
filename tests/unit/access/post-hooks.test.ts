import { ValidationError } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { stampPublishedDate, uniquePostSlug } from '@/collections/hooks/post-hooks'

/**
 * The two `posts` hooks that `pages` does not have.
 *
 * The slug lookup is stubbed so the RULE is tested here; that the query scopes to one school
 * against Postgres is proven in tests/integration/tenant-isolation.test.ts.
 */

const slugArgs = (
  data: Record<string, unknown>,
  taken: string[],
  { id, operation = 'create' }: { id?: string; operation?: 'create' | 'update' } = {},
) => {
  const find = vi.fn(async (_args: { where?: unknown }) => ({
    docs: taken.map((slug, i) => ({ id: `other-${i}`, slug })),
  }))
  return {
    args: {
      data,
      req: { payload: { find } },
      operation,
      originalDoc: id ? { id, tenant: data.tenant ?? 'A' } : undefined,
    } as never,
    find,
  }
}

describe('uniquePostSlug', () => {
  it('keeps a free slug', async () => {
    const { args } = slugArgs({ tenant: 'A', slug: 'picture-day' }, [])
    await expect(uniquePostSlug(args)).resolves.toMatchObject({ slug: 'picture-day' })
  })

  it('numbers a NEW post whose title another post in the school already used', async () => {
    const { args } = slugArgs({ tenant: 'A', slug: 'picture-day' }, ['picture-day'])
    await expect(uniquePostSlug(args)).resolves.toMatchObject({ slug: 'picture-day-2' })
  })

  it('asks only within the post’s own school', async () => {
    const { args, find } = slugArgs({ tenant: 'A', slug: 'picture-day' }, [])
    await uniquePostSlug(args)
    expect(JSON.stringify(find.mock.calls[0]![0].where)).toContain('"tenant":{"equals":"A"}')
  })

  it('REFUSES an edit that moves a post onto another post’s address', async () => {
    /**
     * Only the district can get here on purpose (a school manager never types a slug), and
     * silently renumbering a slug they chose would publish a URL they did not pick.
     */
    const { args } = slugArgs({ slug: 'picture-day' }, ['picture-day'], {
      id: 'self',
      operation: 'update',
    })
    await expect(uniquePostSlug(args)).rejects.toBeInstanceOf(ValidationError)
  })

  it('lets a post keep its own slug on update', async () => {
    const find = vi.fn(async () => ({ docs: [{ id: 'self', slug: 'picture-day' }] }))
    const args = {
      data: { slug: 'picture-day' },
      req: { payload: { find } },
      operation: 'update',
      originalDoc: { id: 'self', tenant: 'A' },
    } as never
    await expect(uniquePostSlug(args)).resolves.toMatchObject({ slug: 'picture-day' })
  })

  it('does nothing on a write that carries no slug', async () => {
    const { args, find } = slugArgs({ title: 'x' }, ['picture-day'], {
      id: 'self',
      operation: 'update',
    })
    await expect(uniquePostSlug(args)).resolves.toEqual({ title: 'x' })
    expect(find).not.toHaveBeenCalled()
  })
})

describe('stampPublishedDate', () => {
  const NOW = '2026-10-28T12:00:00.000Z'
  const run = (data: Record<string, unknown>, originalDoc?: Record<string, unknown>) =>
    stampPublishedDate({ data, originalDoc, now: () => NOW })

  it('dates a post the first time it publishes', () => {
    expect(run({ _status: 'published' })).toMatchObject({ publishedDate: NOW })
  })

  it('never re-dates a post that already has a date — an edit is not news', () => {
    expect(run({ _status: 'published' }, { publishedDate: '2026-09-01T00:00:00.000Z' })).toEqual({
      _status: 'published',
    })
  })

  it('keeps a date the district typed', () => {
    expect(run({ _status: 'published', publishedDate: '2026-09-01T00:00:00.000Z' })).toMatchObject({
      publishedDate: '2026-09-01T00:00:00.000Z',
    })
  })

  it('leaves a draft undated', () => {
    expect(run({ _status: 'draft' })).toEqual({ _status: 'draft' })
  })
})
