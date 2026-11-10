import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getTestPayload, seed } from '../helpers/payload'

/**
 * "Clone" in the page toolbar (Jason, 2026-10-29) is Payload's duplicate. The copy is a DRAFT,
 * says it is a copy, takes a free address beside the original, and is not scheduled to go live
 * — a clone publishing itself at the original's time would be a surprise nobody chose.
 */

let payload: Payload
let f: Awaited<ReturnType<typeof seed>>
const made: (string | number)[] = []

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

afterAll(async () => {
  for (const id of made.reverse()) {
    await payload.delete({ collection: 'pages', id, overrideAccess: true }).catch(() => null)
  }
})

describe('cloning a page', () => {
  it('makes a draft copy with its own address, and no scheduled publish', async () => {
    const original = await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantB,
        title: 'Supply list',
        slug: 'clone-supply-list',
        visibility: 'public',
        publishAt: '2030-01-01T00:00:00.000Z',
        _status: 'published',
      },
      user: f.districtAdmin,
      overrideAccess: true,
    })
    made.push(original.id)

    const first = await payload.duplicate({
      collection: 'pages',
      id: original.id,
      // As the toolbar's REST call does: `POST /api/pages/:id/duplicate` defaults to a draft.
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    made.push(first.id)
    expect(first.title).toBe('Supply list (copy)')
    expect(first.slug).toBe('clone-supply-list-copy')
    expect(first._status).toBe('draft')
    expect(first.publishAt ?? null).toBeNull()
    // The original was published with a Start to come, so it is scheduled; its clone is not.
    expect(first.reviewState ?? null).toBeNull()

    // A second clone of the same page takes the next free address.
    const second = await payload.duplicate({
      collection: 'pages',
      id: original.id,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    made.push(second.id)
    expect(second.slug).toBe('clone-supply-list-copy-2')
  })
})
