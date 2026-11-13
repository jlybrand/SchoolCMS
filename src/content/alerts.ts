import { getPayload } from 'payload'

import config from '@payload-config'

import { alertApplies, isDismissible, sortAlerts, type AlertRule } from '@/lib/alerts'

import type { AlertPageRef, ContentContext, SiteAlert } from './types'

/**
 * The alert banners for one page of one site, now (Jason, 2026-11-12). The rules are
 * `src/lib/alerts.ts`; this reads the district's alerts and the site's levels and applies them.
 *
 * Read as the platform: alerts are the district's to write but everyone's to see. Runs at render
 * and revalidate time with the page, never per visitor (`02` §5); saving an alert, and its start
 * or end passing, revalidates every site.
 */
type Row = Record<string, unknown>

const ids = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [])
    .map((v) => (typeof v === 'object' && v !== null ? (v as { id?: unknown }).id : v))
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    .map(String)

const ticked = (group: unknown): string[] =>
  Object.entries((group ?? {}) as Record<string, unknown>)
    .filter(([, on]) => on === true)
    .map(([level]) => level)

const iso = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? new Date(value).toISOString() : null

export const getAlerts = async (
  ctx: Pick<ContentContext, 'tenant'>,
  page: AlertPageRef,
  now: Date = new Date(),
): Promise<SiteAlert[]> => {
  const payload = await getPayload({ config })
  const t = now.toISOString()
  const [{ docs }, tenant] = await Promise.all([
    payload.find({
      collection: 'alerts',
      where: {
        and: [
          { or: [{ startAt: { exists: false } }, { startAt: { less_than_equal: t } }] },
          { or: [{ endAt: { exists: false } }, { endAt: { greater_than: t } }] },
        ],
      },
      depth: 0,
      limit: 100,
      overrideAccess: true,
    }),
    payload.findByID({
      collection: 'tenants',
      id: ctx.tenant.id,
      depth: 0,
      overrideAccess: true,
      disableErrors: true,
      select: { type: true, gradesServed: true } as never,
    }),
  ])

  const site = {
    id: ctx.tenant.id,
    type: ctx.tenant.type,
    levels: ticked((tenant as Row | null)?.gradesServed),
  }

  const shown = (docs as unknown as Row[]).filter((doc) => {
    const rule: AlertRule = {
      startAt: iso(doc.startAt),
      endAt: iso(doc.endAt),
      siteScope: (doc.siteScope as AlertRule['siteScope']) ?? 'all',
      levels: ticked(doc.levels) as AlertRule['levels'],
      siteIds: ids(doc.sites),
      pageScope: (doc.pageScope as AlertRule['pageScope']) ?? 'every',
      pageIds: ids(doc.pages),
    }
    return alertApplies(rule, site, page, now)
  })

  return sortAlerts(
    shown.map((doc) => ({
      severity: (doc.severity as SiteAlert['severity']) ?? 'info',
      startAt: iso(doc.startAt),
      doc,
    })),
  ).map(({ severity, doc }) => {
    const href = typeof doc.linkUrl === 'string' && doc.linkUrl !== '' ? doc.linkUrl : null
    return {
      id: String(doc.id),
      severity,
      text: typeof doc.text === 'string' ? doc.text : '',
      link: href
        ? {
            href,
            label:
              typeof doc.linkLabel === 'string' && doc.linkLabel.trim() !== ''
                ? doc.linkLabel.trim()
                : 'More information',
          }
        : null,
      dismissible: isDismissible(severity),
      version: String(doc.updatedAt ?? ''),
    }
  })
}
