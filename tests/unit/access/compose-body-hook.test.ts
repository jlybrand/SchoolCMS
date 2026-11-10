import { describe, expect, it } from 'vitest'

import { composeBodyOnWrite } from '@/collections/hooks/compose-body'

/**
 * Every page composed (Jason, 2026-11-04) — the expand step. `body` is no longer on the form, but
 * words can still arrive in it: a page nobody has converted yet, a restored old version, a clone,
 * an API client. Whatever the route, the write leaves the words as a Text section on top and the
 * page composed, so nothing new is ever written to `body`.
 */

const words = (text: string) => ({
  root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] },
})
const divider = { id: 'd1', blockType: 'divider' }

const run = (data: Record<string, unknown>, originalDoc?: Record<string, unknown>) =>
  composeBodyOnWrite({ data, originalDoc } as never) as Record<string, unknown>

describe('composeBodyOnWrite', () => {
  it('moves words sent in `body` into a Text section above the sections sent', () => {
    const out = run({ body: words('Hi.'), layout: [divider] })
    expect(out.layout).toEqual([{ blockType: 'richText', content: words('Hi.') }, divider])
    expect(out.body).toBeNull()
    expect(out.pageType).toBe('composed')
  })

  it('moves the STORED words when the write leaves `body` out — a page not yet converted', () => {
    const out = run({ title: 'New title' }, { body: words('Old.'), layout: [divider] })
    expect(out.layout).toEqual([{ blockType: 'richText', content: words('Old.') }, divider])
    expect(out.body).toBeNull()
  })

  it('above the sections the write sends, not the stored ones, when it sends both', () => {
    const out = run({ layout: [] }, { body: words('Old.'), layout: [divider] })
    expect(out.layout).toEqual([{ blockType: 'richText', content: words('Old.') }])
  })

  it('a write that empties `body` moves nothing', () => {
    const out = run({ body: null, layout: [divider] }, { body: words('Old.') })
    expect(out.layout).toEqual([divider])
    expect(out.pageType).toBe('composed')
  })

  it('a converted page: the write is untouched but for the type', () => {
    const data = { title: 'Same', layout: [divider] }
    expect(run(data, { body: null, layout: [divider], pageType: 'composed' })).toEqual({
      ...data,
      pageType: 'composed',
    })
  })
})
