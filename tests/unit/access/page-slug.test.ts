import { ValidationError } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { deriveSlugFromTitle, uniqueSlugWithinParent } from '@/collections/hooks/page-slug'

/**
 * Sibling-slug uniqueness for `pages`.
 *
 * WHY THIS IS A CORRECTNESS BUG AND NOT A NICETY: a page's URL is assembled from its
 * ancestor chain (`src/lib/slug.ts`), so two siblings sharing a slug produce two pages at
 * ONE path. `getPageByPath` then returns whichever the database happens to order first —
 * non-deterministic, and cached at the edge once resolved (`02` §5). The wrong page can
 * stay served until something purges it.
 *
 * Payload's field-level `unique` cannot express this: uniqueness is per (tenant, parent,
 * slug), not global. Two schools may both have `/about`, and so may two different parents
 * inside one school.
 *
 * The sibling lookup is stubbed here so the RULE is tested in isolation. That the query
 * actually scopes correctly against Postgres is proven in the integration suite.
 */

type FindArgs = { where?: unknown }

/** Builds hook args with a stubbed sibling lookup. */
const hookArgs = (
  data: Record<string, unknown>,
  siblings: unknown[],
  { id, operation = 'create' }: { id?: string; operation?: 'create' | 'update' } = {},
) => {
  const find = vi.fn(async (_args: FindArgs) => ({ docs: siblings }))
  return {
    args: {
      data,
      req: { payload: { find } },
      operation,
      originalDoc: id ? { id } : undefined,
    } as never,
    find,
  }
}

/**
 * The message an editor sees. `ValidationError.message` is Payload's generic "The following
 * field is invalid: slug"; the explanation lives in the per-field error, and that is the
 * string the admin renders under the input — so that is what is worth asserting against the
 * "no training, no documentation" bar (CLAUDE.md).
 */
const fieldErrorFrom = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
    throw new Error('expected the hook to reject, but it resolved')
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError)
    const { errors } = (error as ValidationError).data
    return errors.map((e) => e.message).join(' ')
  }
}

describe('uniqueSlugWithinParent', () => {
  it('allows a slug with no sibling using it', async () => {
    const { args } = hookArgs({ tenant: 'A', slug: 'about', parent: null }, [])
    await expect(uniqueSlugWithinParent(args)).resolves.toBeDefined()
  })

  it('REJECTS a slug already used by a sibling', async () => {
    const { args } = hookArgs({ tenant: 'A', slug: 'about', parent: null }, [{ id: 'other' }])
    const message = await fieldErrorFrom(uniqueSlugWithinParent(args))

    expect(message).toMatch(/already exists/i)
    // Names the offending slug and says WHY, so the fix is obvious without documentation.
    expect(message).toContain('about')
    expect(message).toMatch(/url/i)
  })

  it('allows a document to keep its own slug on update', async () => {
    // The sibling found IS this page. Rejecting here would make every re-save of an
    // unchanged page fail.
    const { args } = hookArgs({ tenant: 'A', slug: 'about', parent: null }, [{ id: 'self' }], {
      id: 'self',
      operation: 'update',
    })
    await expect(uniqueSlugWithinParent(args)).resolves.toBeDefined()
  })

  it('rejects when a DIFFERENT sibling holds the slug on update', async () => {
    const { args } = hookArgs({ tenant: 'A', slug: 'about', parent: null }, [{ id: 'other' }], {
      id: 'self',
      operation: 'update',
    })
    await expect(fieldErrorFrom(uniqueSlugWithinParent(args))).resolves.toMatch(/already exists/i)
  })

  it('scopes the sibling query by tenant AND parent', async () => {
    /**
     * The assertion that matters for isolation. A query missing the tenant clause would
     * make one school's page titles collide with another's — and worse, would leak the
     * existence of another tenant's pages through the validation error (`03` §6.4).
     */
    const { args, find } = hookArgs({ tenant: 'A', slug: 'about', parent: 'p1' }, [])
    await uniqueSlugWithinParent(args)

    const where = find.mock.calls[0]?.[0]?.where as { and?: unknown[] }
    expect(where.and).toEqual(
      expect.arrayContaining([{ tenant: { equals: 'A' } }, { parent: { equals: 'p1' } }]),
    )
  })

  it('queries for a null parent as a top-level page, not as a missing filter', async () => {
    // Omitting the clause entirely would compare against every page in the tenant, so a
    // top-level `/about` would collide with a nested `/x/about`.
    const { args, find } = hookArgs({ tenant: 'A', slug: 'about', parent: null }, [])
    await uniqueSlugWithinParent(args)

    const where = find.mock.calls[0]?.[0]?.where as { and?: unknown[] }
    expect(where.and).toEqual(expect.arrayContaining([{ parent: { exists: false } }]))
  })

  it('skips the lookup when the write carries no slug', async () => {
    // A partial update that does not touch the slug has nothing to check, and a query on
    // `undefined` would match unpredictably.
    const { args, find } = hookArgs({ tenant: 'A', title: 'Edited' }, [{ id: 'other' }], {
      operation: 'update',
    })
    await expect(uniqueSlugWithinParent(args)).resolves.toBeDefined()
    expect(find).not.toHaveBeenCalled()
  })

  it('returns the data unchanged when it allows the write', async () => {
    const data = { tenant: 'A', slug: 'about', parent: null }
    const { args } = hookArgs(data, [])
    await expect(uniqueSlugWithinParent(args)).resolves.toEqual(data)
  })
})

describe('deriveSlugFromTitle', () => {
  /**
   * Against the usability bar (CLAUDE.md): a school manager who last logged in five months
   * ago should not have to know what a slug is. Typing a title is enough.
   */
  const derive = (data: Record<string, unknown>, operation: 'create' | 'update' = 'create') =>
    deriveSlugFromTitle({ data, operation } as never) as Record<string, unknown>

  it('derives a slug from the title on create', () => {
    expect(derive({ title: 'Bell Schedule' }).slug).toBe('bell-schedule')
  })

  it('normalizes a slug the editor typed by hand', () => {
    expect(derive({ title: 'Bell Schedule', slug: 'Bell Schedule!' }).slug).toBe('bell-schedule')
  })

  it('prefers an explicit slug over the title', () => {
    expect(derive({ title: 'Bell Schedule', slug: 'bells' }).slug).toBe('bells')
  })

  it('does NOT re-derive from the title on update', () => {
    /**
     * The property that protects live URLs. Renaming a page's title must not silently move
     * it — that breaks every inbound link, every bookmark, and the redirect map built in
     * `10` §6. Changing the URL has to be a deliberate edit to the slug itself.
     */
    expect(derive({ title: 'A Completely New Title' }, 'update').slug).toBeUndefined()
  })

  it('still normalizes an explicit slug on update', () => {
    expect(derive({ slug: 'New Slug' }, 'update').slug).toBe('new-slug')
  })

  it('leaves the slug empty when the title yields nothing, rather than inventing one', () => {
    // Field validation then refuses the save with a message. A generated fallback would be
    // a URL nobody can predict.
    expect(derive({ title: '！！！' }).slug).toBe('')
  })

  it('passes other fields through untouched', () => {
    const result = derive({ title: 'About', visibility: 'staff', tenant: 'A' })
    expect(result.visibility).toBe('staff')
    expect(result.tenant).toBe('A')
  })
})
