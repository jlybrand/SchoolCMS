import { beforeAll, describe, expect, it } from 'vitest'

import { getTenantByHostname, listActiveTenants } from '@/content/tenants'
import type { Payload } from 'payload'

import { getTestPayload, seed } from '../helpers/payload'

/**
 * Content-access layer (`02` §11, ADR-5, `06` §2.8).
 *
 * Two things under test, and the second is the architectural one:
 *
 *  1. The functions return correct data.
 *  2. They return **DD2 domain types, not Payload documents.** That is the whole hedge —
 *     it is what makes swapping the CMS a rewrite of ~8 files rather than ~200 components.
 *     A function that leaks `createdAt`, `updatedAt`, or a Payload relationship object has
 *     silently widened the boundary, and every component that starts consuming those fields
 *     deepens the coupling.
 */

let payload: Payload

beforeAll(async () => {
  payload = await getTestPayload()
  await seed(payload)
}, 120_000)

describe('getTenantByHostname', () => {
  it('resolves a known host', async () => {
    const tenant = await getTenantByHostname('a.localhost')
    expect(tenant?.slug).toBe('school-a')
    expect(tenant?.type).toBe('school')
  })

  it('normalizes case, port, and trailing dot before matching', async () => {
    for (const host of ['A.LOCALHOST', 'a.localhost:3000', 'a.localhost.']) {
      expect((await getTenantByHostname(host))?.slug).toBe('school-a')
    }
  })

  it('returns null for an unknown host — never a fallback tenant', async () => {
    /**
     * `02` §4.1 — an unknown host 404s or redirects to the district. Falling back to a
     * default would serve one school's content on another school's domain, which the
     * access layer would never catch because it happens before scoping.
     */
    expect(await getTenantByHostname('unknown.example.com')).toBeNull()
    expect(await getTenantByHostname(null)).toBeNull()
    expect(await getTenantByHostname('')).toBeNull()
  })

  it('does not resolve a hidden tenant', async () => {
    const hidden = await payload.create({
      collection: 'tenants',
      data: {
        name: 'Hidden',
        slug: 'hidden',
        hostname: 'hidden.localhost',
        type: 'school',
        status: 'hidden',
      },
      overrideAccess: true,
    })

    expect(await getTenantByHostname('hidden.localhost')).toBeNull()

    await payload.delete({ collection: 'tenants', id: hidden.id, overrideAccess: true })
  })
})

describe('the boundary — domain types only', () => {
  it('returns exactly the DD2 Tenant shape, with no Payload fields leaking', async () => {
    const tenant = await getTenantByHostname('a.localhost')
    expect(tenant).not.toBeNull()

    expect(Object.keys(tenant!).sort()).toEqual(['hostname', 'id', 'name', 'slug', 'type'])

    // Explicitly assert the Payload-isms that would signal a widened boundary.
    for (const leaked of ['createdAt', 'updatedAt', '_status', 'powerSchoolBuildingId', 'status']) {
      expect(tenant).not.toHaveProperty(leaked)
    }
  })

  it('returns ids as strings, insulating callers from the database id type', async () => {
    // Postgres issues numeric ids. Normalizing at the boundary means a CMS or database
    // change cannot ripple into every component's prop types.
    const tenant = await getTenantByHostname('a.localhost')
    expect(typeof tenant?.id).toBe('string')
  })

  it('applies the same shape to every item from listActiveTenants', async () => {
    const tenants = await listActiveTenants()
    expect(tenants.length).toBeGreaterThanOrEqual(3)

    for (const tenant of tenants) {
      expect(Object.keys(tenant).sort()).toEqual(['hostname', 'id', 'name', 'slug', 'type'])
      expect(typeof tenant.id).toBe('string')
    }
  })

  it('excludes hidden tenants from listActiveTenants', async () => {
    const tenants = await listActiveTenants()
    expect(tenants.every((t) => t.slug !== 'hidden')).toBe(true)
  })
})
