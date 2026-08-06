import { DEFAULT_LOCALE } from './locales'

/**
 * Cache tags for targeted invalidation (`09` §4.2, `02` §5–6).
 *
 * Publish triggers on-demand revalidation plus a Cloudflare tag purge for exactly the
 * affected paths. Content goes live in seconds; everything else stays warm — which is what
 * lets the CDN absorb a 100x closure-day spike without the origin scaling (`09` §4.3).
 *
 * Two failure modes to design against:
 *   - **Under-purging** serves stale content. On a closure day that is a safety problem,
 *     not a cosmetic one.
 *   - **Over-purging** dumps the warm cache and pushes load to the origin at exactly the
 *     wrong moment.
 *
 * Both are avoided by namespacing every tag kind so ids from different axes cannot collide.
 */

const clean = (value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  return str === '' ? null : str
}

export const tenantTag = (tenantId: string | number): string => `tenant:${String(tenantId)}`

export const documentTag = (collection: string, id: string | number): string =>
  `${collection}:${String(id)}`

export const localeTag = (locale: string): string => `locale:${locale}`

export const collectionTag = (collection: string): string => `collection:${collection}`

export type DocumentTagInput = {
  collection: string
  id: string | number
  tenantId: string | number
  /** COPE targets — every tenant that renders this item (`02` §6). */
  syndicatedTo?: readonly (string | number)[]
  /** Every locale variant of this document; each is a separate cached artifact. */
  locales?: readonly string[]
}

/**
 * Every tag that should be purged when a document changes.
 *
 * Includes the syndication fan-out: a district post referenced by school tenants must purge
 * on every surface that renders it, or an edit appears on the district site and not on the
 * schools showing the same item.
 */
export const tagsForDocument = ({
  collection,
  id,
  tenantId,
  syndicatedTo = [],
  locales = [DEFAULT_LOCALE],
}: DocumentTagInput): string[] => {
  const tags = new Set<string>()

  const docId = clean(id)
  const coll = clean(collection)
  if (!coll || !docId) return []

  tags.add(collectionTag(coll))
  tags.add(documentTag(coll, docId))

  const owning = clean(tenantId)
  if (owning) tags.add(tenantTag(owning))

  for (const target of syndicatedTo) {
    const t = clean(target)
    if (t) tags.add(tenantTag(t))
  }

  const localeList = locales.length > 0 ? locales : [DEFAULT_LOCALE]
  for (const locale of localeList) {
    const l = clean(locale)
    if (!l) continue
    tags.add(localeTag(l))
    tags.add(`${documentTag(coll, docId)}:${l}`)
  }

  return [...tags]
}
