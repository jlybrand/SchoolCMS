import type { Payload } from 'payload'

import { adminBrand, type AdminBrand } from './brand'

/**
 * The district site's logo for the admin's brand band (Jason, 2026-11-18). Read with access
 * overridden: Settings are district-only, but a school manager's start screen carries the
 * district's logo too, and it is the district's public logo, nothing more. Only `logo` is read.
 */
/** `school`: a school manager's school's name, shown in place of the platform's. */
export const getAdminBrand = async (payload: Payload, school?: string): Promise<AdminBrand> => {
  const district = await payload.find({
    collection: 'tenants',
    where: { type: { equals: 'district' } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    select: { name: true },
  })
  const tenant = district.docs[0]?.id
  if (tenant === undefined) return adminBrand(null, school)
  const settings = await payload.find({
    collection: 'settings',
    where: { tenant: { equals: tenant } },
    limit: 1,
    depth: 1,
    overrideAccess: true,
    select: { logo: true },
  })
  return adminBrand((settings.docs[0] as { logo?: unknown } | undefined) ?? null, school)
}
