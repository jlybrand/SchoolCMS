import { ValidationError } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import {
  boardIsThisSchools,
  boardTitle,
  postNeedsWords,
  stampPublishedDate,
  uniquePostSlug,
} from '@/collections/hooks/post-hooks'

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

/**
 * An announcement needs words before anyone sees it. Not `required` on the field: "Post an
 * announcement" creates the post from its headline first, so autosave covers it from the first
 * keystroke (as "Add a page" does) — and a required body would refuse that create. The words
 * are required at the two moments that matter instead: sending it, and publishing it.
 */
describe('postNeedsWords', () => {
  const words = {
    root: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Thursday.' }] }],
    },
  }
  const empty = { root: { type: 'root', children: [{ type: 'paragraph', children: [] }] } }

  it.each([
    ['sending it', { reviewState: 'submitted' }, { reviewState: 'editing' }],
    ['publishing it', { _status: 'published' }, {}],
  ])('refuses %s with no words', (_label, data, originalDoc) => {
    expect(() => postNeedsWords({ data: { ...data, body: empty }, originalDoc })).toThrow(
      ValidationError,
    )
    expect(() => postNeedsWords({ data, originalDoc })).toThrow(ValidationError)
  })

  it('reads the stored words when the write does not carry them', () => {
    expect(() =>
      postNeedsWords({ data: { _status: 'published' }, originalDoc: { body: words } }),
    ).not.toThrow()
  })

  it('lets an empty announcement be saved — a headline with no words yet is work in progress', () => {
    expect(() => postNeedsWords({ data: { title: 'Picture day', body: empty } })).not.toThrow()
  })

  it('lets a save on an announcement already waiting through — it was checked when sent', () => {
    expect(() =>
      postNeedsWords({
        data: { reviewState: 'submitted', body: empty },
        originalDoc: { reviewState: 'submitted' },
      }),
    ).not.toThrow()
  })

  it('says what to do, on the body', () => {
    let caught: unknown
    try {
      postNeedsWords({ data: { reviewState: 'submitted' } })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ValidationError)
    const [first] = (caught as ValidationError).data.errors
    expect(first).toMatchObject({ path: 'body' })
    expect(first!.message).toMatch(/write the announcement/i)
  })
})

/**
 * A post's board is its own school's (Jason, 2026-10-28: boards are per site). The board picker
 * offers only those; this is the API's half, so a hand-made request cannot file a post on
 * another school's board.
 */
describe('boardIsThisSchools', () => {
  const boards: Record<string, { tenant: unknown }> = {
    '7': { tenant: 'A' },
    '8': { tenant: { id: 'B' } },
  }
  const run = (data: Record<string, unknown>, originalDoc?: Record<string, unknown>) => {
    const findByID = vi.fn(async ({ id }: { id: string }) => boards[id] ?? null)
    return boardIsThisSchools({
      data,
      originalDoc,
      req: { payload: { findByID } },
    } as never)
  }

  it('accepts a board of the post’s own school', async () => {
    await expect(run({ tenant: 'A', board: 7 })).resolves.toMatchObject({ board: 7 })
  })

  it('reads the school from the stored post when the write does not carry it', async () => {
    await expect(run({ board: '7' }, { tenant: 'A' })).resolves.toBeDefined()
  })

  it('REFUSES another school’s board, on the board field', async () => {
    await expect(run({ tenant: 'A', board: 8 })).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses a board that does not exist', async () => {
    await expect(run({ tenant: 'A', board: 99 })).rejects.toBeInstanceOf(ValidationError)
  })

  it('does nothing on a write that does not set a board', async () => {
    await expect(run({ title: 'x' }, { tenant: 'A' })).resolves.toEqual({ title: 'x' })
  })
})

/** How a board is named wherever one is picked or shown: its folder, then its own name. */
describe('boardTitle', () => {
  it('is "Folder → Board"', () => {
    expect(boardTitle(' SHS ', ' News ')).toBe('SHS → News')
  })

  it('is the board alone when the folder has no name', () => {
    expect(boardTitle(undefined, 'News')).toBe('News')
  })
})
