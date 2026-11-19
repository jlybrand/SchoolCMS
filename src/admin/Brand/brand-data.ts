import type { Payload } from 'payload'

import { adminBrand, type AdminBrand } from './brand'

/** One tenant's row of a per-site collection, the named fields only, read with access overridden. */
const rowOf = async (
  payload: Payload,
  collection: 'settings' | 'theme',
  tenant: number | string,
  select: Record<string, true>,
): Promise<Record<string, unknown> | null> => {
  const found = await payload.find({
    collection,
    where: { tenant: { equals: tenant } },
    limit: 1,
    depth: collection === 'settings' ? 1 : 0,
    overrideAccess: true,
    select,
  })
  return (found.docs[0] as Record<string, unknown> | undefined) ?? null
}

/**
 * The admin's brand band (Jason, 2026-11-18). Read with access overridden: Settings and Colors are
 * district-only to EDIT, but what is read here is public on every site anyway — a logo and two
 * colors, nothing more.
 *
 * `school`: a school manager's school (Jason, 2026-11-18; 2026-11-19). Its band shows its name,
 * its own logo (the district's when it has none) and its two colors on the underline.
 */
export const getAdminBrand = async (
  payload: Payload,
  school?: { id: number | string; name: string },
): Promise<AdminBrand> => {
  const district = await payload.find({
    collection: 'tenants',
    where: { type: { equals: 'district' } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    select: { name: true },
  })
  const districtId = district.docs[0]?.id
  const [districtSettings, schoolSettings, schoolTheme] = await Promise.all([
    districtId === undefined ? null : rowOf(payload, 'settings', districtId, { logo: true }),
    school ? rowOf(payload, 'settings', school.id, { logo: true }) : null,
    school
      ? rowOf(payload, 'theme', school.id, { primaryColor: true, secondaryColor: true })
      : null,
  ])
  return adminBrand(
    districtSettings,
    school ? { name: school.name, settings: schoolSettings, theme: schoolTheme } : undefined,
  )
}
