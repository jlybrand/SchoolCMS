import { getPayload } from 'payload'

import config from '@payload-config'

import { normalizeHostname } from '@/lib/tenant'
import type { Tenant } from './types'

/**
 * Tenant lookups — the first function in the content-access layer (`02` §11, ADR-5).
 *
 * ============================================================================
 * THIS FILE IS ON THE PAYLOAD SIDE OF THE BOUNDARY.
 * It may import the SDK. It returns DD2 domain types and nothing else.
 * The public rendering layer calls these functions and never Payload
 * directly — CI enforces that (`06` §2.8).
 * ============================================================================
 *
 * Mapping to domain types happens HERE, once, so swapping the CMS means rewriting this
 * directory rather than every component.
 */

/**
 * Payload's shape for a tenant row. Declared locally rather than imported from
 * `payload-types`, so a schema regeneration cannot silently change the domain type the rest
 * of the app consumes — the mapper below would fail to compile instead.
 */
type PayloadTenant = {
  id: string | number
  name: string
  slug: string
  hostname: string
  type: 'district' | 'school'
  status?: 'active' | 'hidden' | null
}

const toDomain = (doc: PayloadTenant): Tenant => ({
  id: String(doc.id),
  slug: doc.slug,
  name: doc.name,
  hostname: doc.hostname,
  type: doc.type,
})

/**
 * Resolves a request Host to its tenant (`02` §4.1).
 *
 * Runs at build and revalidate time, NOT per visitor — the database is never in the public
 * request path (`02` §5). Access is overridden because this is the platform resolving its
 * own routing table, not a user reading data; the public read rules that matter apply to
 * content, which lands in Phase 3.
 *
 * Returns null for an unknown or hidden host. The caller 404s or redirects to the district
 * (`02` §4.1) — never falls back to a default tenant, which would serve one school's
 * content on another school's domain.
 */
export const getTenantByHostname = async (
  host: string | null | undefined,
): Promise<Tenant | null> => {
  const hostname = normalizeHostname(host)
  if (!hostname) return null

  const payload = await getPayload({ config })

  const { docs } = await payload.find({
    collection: 'tenants',
    where: { and: [{ hostname: { equals: hostname } }, { status: { equals: 'active' } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const doc = docs[0]
  return doc ? toDomain(doc as PayloadTenant) : null
}

/**
 * Every active tenant. Used to generate static params so all 28 sites build, and by the
 * middleware's hostname map.
 *
 * Deliberately unbounded by a hardcoded count — the tenant list is data, and `01` §8 is
 * explicit that the model must not hardcode 28.
 */
export const listActiveTenants = async (): Promise<Tenant[]> => {
  const payload = await getPayload({ config })

  const { docs } = await payload.find({
    collection: 'tenants',
    where: { status: { equals: 'active' } },
    limit: 1000,
    depth: 0,
    sort: 'slug',
    overrideAccess: true,
  })

  return (docs as PayloadTenant[]).map(toDomain)
}
