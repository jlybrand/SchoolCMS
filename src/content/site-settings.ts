import { toEmailHref, toPhoneHref, toSocialHref } from '@/lib/contact'
import { toEnabledLocales } from '@/lib/locales'

import type { ContactLink, SiteSettings, SocialLink, SocialPlatform } from './types'

/**
 * Payload `settings` row -> DD2 site settings (`03` §5, `02` §11).
 *
 * PURE, and in its own file for the reason `menus.ts` is: `settings.ts` imports the Payload
 * config to run the query.
 *
 * Takes `unknown` and never throws. Settings render on every page of a tenant, so a
 * malformed value costs that value and its neighbours render — and every destination is
 * checked HERE as well as by its field validator, which only tells the editor.
 */

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** The closed list, and what each is called. The collection's options are built from this. */
export const SOCIAL_PLATFORMS: Readonly<Record<SocialPlatform, string>> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
}

const isPlatform = (value: unknown): value is SocialPlatform =>
  typeof value === 'string' && Object.hasOwn(SOCIAL_PLATFORMS, value)

const toContactLink = (
  value: unknown,
  toHref: (value: unknown) => string | null,
): ContactLink | null => {
  const text = str(value)
  const href = toHref(text)
  return text === null || href === null ? null : { text, href }
}

const toSocial = (value: unknown): SocialLink[] => {
  if (!Array.isArray(value)) return []

  const links: SocialLink[] = []

  value.forEach((row, index) => {
    if (!isRow(row) || !isPlatform(row.platform)) return

    const href = toSocialHref(row.url)
    if (href === null) return

    links.push({
      id: str(row.id) ?? `social-${index}`,
      platform: row.platform,
      label: SOCIAL_PLATFORMS[row.platform],
      href,
    })
  })

  return links
}

export const toSiteSettings = (doc: unknown): SiteSettings => {
  const row: Row = isRow(doc) ? doc : {}
  const contact: Row = isRow(row.contact) ? row.contact : {}

  return {
    siteTitle: str(row.siteTitle),
    contact: {
      address: (str(contact.address) ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
      phone: toContactLink(contact.phone, toPhoneHref),
      email: toContactLink(contact.email, toEmailHref),
    },
    social: toSocial(row.socialLinks),
    defaultDescription: str(row.defaultDescription),
    enabledLocales: toEnabledLocales(row.enabledLocales),
  }
}
