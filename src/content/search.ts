import { sql } from '@payloadcms/db-postgres/drizzle'
import { getPayload } from 'payload'

import config from '@payload-config'

import { toEventOccurrences } from '@/lib/event-format'
import { DEFAULT_LOCALE, localizedPath } from '@/lib/locales'
import { postHref } from '@/lib/post-url'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'
import { addDays, localDateOf } from '@/lib/recurrence'
import { publicUrlFor } from '@/lib/review-emails'
import { MATCH_END, MATCH_START, normalizeQuery, splitSnippet } from '@/lib/search'

import { fileSizeLabel, fileTypeLabel } from './document-item'
import { toCalendarEvent } from './event-mapper'
import { listPagePathIndex } from './pages'
import type { ContentContext, SearchResult, SearchResults, SearchScope, Tenant } from './types'

/**
 * SITE SEARCH (Jason, 2026-11-16; Phase 6 D; ADR-14 Postgres full-text search).
 *
 * ============================================================================
 * THIS FILE IS ON THE PAYLOAD SIDE OF THE BOUNDARY. It returns DD2 domain types only.
 * ============================================================================
 *
 * Searches the index the search plugin keeps (`src/collections/search-index.ts`) with Postgres
 * full-text search: the title weighted above the words, ranked, a snippet around the match.
 *
 * SCOPE IS IN THE WHERE CLAUSE — the cross-tenant rule for this feature (`03` §6.4), proven in
 * tests/integration/search.test.ts:
 *   - never an `excluded` entry (staff-only, hidden, an image);
 *   - "this site": its own entries, plus announcements shared with it — district-wide, or to it by
 *     name — exactly the reach a news feed has (`syndication.ts`);
 *   - "every site": everything public, each result labelled with its site.
 *   - events over a year ago are left out.
 *
 * Parameterised SQL through Payload's own Drizzle connection — the visitor's words are a bound
 * value, never part of the statement. Runs per request: a search page is not cached.
 */

const PER_PAGE = 10

/** Events stay findable for a year after they last happen. */
const EVENT_DAYS_BACK = 365

type Row = {
  id: number
  kind: SearchResult['kind']
  title: string | null
  tenant_id: number | null
  href: string | null
  snippet: string | null
  total: number | string
  pages_id: number | null
  posts_id: number | null
  events_id: number | null
  resources_id: number | null
}

const EMPTY = (scope: SearchScope, query: string | null): SearchResults => ({
  query,
  scope,
  total: 0,
  page: 1,
  pageCount: 0,
  results: [],
})

export const searchSite = async (
  ctx: ContentContext,
  { query: raw, scope, page: rawPage = 1 }: { query: unknown; scope: SearchScope; page?: number },
): Promise<SearchResults> => {
  const query = normalizeQuery(raw)
  if (query === null) return EMPTY(scope, null)

  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const payload = await getPayload({ config })
  const site = Number(ctx.tenant.id)
  const since = new Date(Date.now() - EVENT_DAYS_BACK * 86_400_000).toISOString()
  const all = scope === 'all'
  const headline = `StartSel=${MATCH_START}, StopSel=${MATCH_END}, MaxFragments=1, MaxWords=30, MinWords=12`

  const result = await (
    payload.db as unknown as { drizzle: { execute: (q: unknown) => Promise<{ rows: Row[] }> } }
  ).drizzle.execute(sql`
    WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS query)
    SELECT s.id, s.kind, s.title, s.tenant_id, s.href,
           ts_headline('english', coalesce(s.text, ''), q.query, ${headline}) AS snippet,
           count(*) OVER () AS total,
           r.pages_id, r.posts_id, r.events_id, r.resources_id
      FROM search s
      JOIN search_rels r ON r.parent_id = s.id AND r.path = 'doc'
      CROSS JOIN q
      CROSS JOIN LATERAL (
        SELECT setweight(to_tsvector('english', coalesce(s.title, '')), 'A')
            || setweight(to_tsvector('english', coalesce(s.text, '')), 'B') AS vector
      ) v
     WHERE s.excluded = false
       AND v.vector @@ q.query
       AND (s.kind <> 'event' OR s.last_date >= ${since})
       AND (
             ${all}
          OR s.tenant_id = ${site}
          OR (s.kind = 'post'
              AND (s.reach_all OR s.reach_sites @> jsonb_build_array(${String(site)}::text)))
       )
     ORDER BY ts_rank_cd(v.vector, q.query) DESC, s.title ASC, s.id ASC
     LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}
  `)
  const rows = result.rows
  const total = rows.length === 0 ? 0 : Number(rows[0]!.total)
  if (total === 0) return { ...EMPTY(scope, query), page }

  return {
    query,
    scope,
    total,
    page,
    pageCount: Math.ceil(total / PER_PAGE),
    results: await shape(ctx, rows),
  }
}

/** Rows to results: each one's address, site, and the details its kind shows. */
const shape = async (ctx: ContentContext, rows: readonly Row[]): Promise<SearchResult[]> => {
  const payload = await getPayload({ config })
  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? ''
  const ids = (key: keyof Row) =>
    rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number')

  const tenantIds = [
    ...new Set(rows.map((r) => r.tenant_id).filter((t): t is number => t !== null)),
  ]
  const [tenants, posts, events, files] = await Promise.all([
    payload.find({
      collection: 'tenants',
      where: { id: { in: tenantIds } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
      select: { name: true, slug: true, hostname: true, type: true },
    }),
    payload.find({
      collection: 'posts',
      where: { id: { in: ids('posts_id') } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
      select: { slug: true, tenant: true },
    }),
    payload.find({
      collection: 'events',
      where: { id: { in: ids('events_id') } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'resources',
      where: { id: { in: ids('resources_id') } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
      select: { mimeType: true, filesize: true },
    }),
  ])

  // A site is named as its own pages name it: its settings' title, else the tenant's name.
  const { docs: titled } = await payload.find({
    collection: 'settings',
    where: { tenant: { in: tenantIds } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    select: { siteTitle: true, tenant: true },
  })
  const siteTitles = new Map(
    (titled as unknown as { siteTitle?: unknown; tenant?: unknown }[]).flatMap((row) => {
      const id =
        row.tenant && typeof row.tenant === 'object'
          ? (row.tenant as { id: unknown }).id
          : row.tenant
      return typeof row.siteTitle === 'string' && row.siteTitle.trim() !== ''
        ? [[String(id), row.siteTitle.trim()] as const]
        : []
    }),
  )

  const tenantById = new Map(
    tenants.docs.map((t) => [
      String(t.id),
      {
        id: String(t.id),
        name: siteTitles.get(String(t.id)) ?? String(t.name ?? ''),
        slug: String(t.slug ?? ''),
        hostname: String(t.hostname ?? ''),
        type: t.type === 'district' ? 'district' : 'school',
      } as Tenant,
    ]),
  )
  const here = ctx.tenant.id

  /** Each result site's page paths, read once per site. */
  const pathIndexes = new Map<string, Promise<Map<string, string>>>()
  const pathsFor = (tenant: Tenant) => {
    if (!pathIndexes.has(tenant.id)) {
      pathIndexes.set(tenant.id, listPagePathIndex({ tenant, locale: ctx.locale }))
    }
    return pathIndexes.get(tenant.id)!
  }
  /** A site path from the site searched from: here, in the visitor's language; elsewhere, its address. */
  const linkTo = (tenant: Tenant, path: string) =>
    tenant.id === here
      ? localizedPath(path, ctx.locale)
      : publicUrlFor(serverUrl, tenant.hostname, localizedPath(path, DEFAULT_LOCALE))

  const postById = new Map(posts.docs.map((p) => [String(p.id), p as Record<string, unknown>]))
  const eventById = new Map(
    events.docs.map((e) => [String(e.id), e as unknown as Record<string, unknown>]),
  )
  const fileById = new Map(files.docs.map((d) => [String(d.id), d as Record<string, unknown>]))

  const today = localDateOf(new Date().toISOString(), DISTRICT_TIME_ZONE)

  return Promise.all(
    rows.map(async (row): Promise<SearchResult> => {
      const tenant = row.tenant_id === null ? null : (tenantById.get(String(row.tenant_id)) ?? null)
      const base = {
        id: `${row.kind}-${row.id}`,
        kind: row.kind,
        title: row.title ?? '',
        siteName: tenant && tenant.id !== here ? tenant.name : null,
        snippet: splitSnippet(row.snippet ?? ''),
        event: null,
        file: null,
      }
      if (tenant === null) return { ...base, href: null }

      switch (row.kind) {
        case 'page': {
          const path = (await pathsFor(tenant)).get(String(row.pages_id))
          return { ...base, href: path === undefined ? null : linkTo(tenant, path) }
        }
        case 'post': {
          const doc = postById.get(String(row.posts_id))
          const slug = typeof doc?.slug === 'string' ? doc.slug : null
          return {
            ...base,
            href:
              slug === null
                ? null
                : postHref(
                    { slug, tenantId: tenant.id, homeHostname: tenant.hostname },
                    { siteTenantId: here, locale: ctx.locale, serverUrl },
                  ),
          }
        }
        case 'document': {
          const file = fileById.get(String(row.resources_id))
          const size = fileSizeLabel(file?.filesize)
          const type = fileTypeLabel(file?.mimeType)
          return { ...base, href: row.href, file: size === null ? type : `${type}, ${size}` }
        }
        case 'event': {
          const doc = eventById.get(String(row.events_id))
          const event = doc ? toCalendarEvent(doc) : null
          if (!event) return { ...base, href: null }
          const occurrences = toEventOccurrences(
            [event],
            { from: addDays(today, -EVENT_DAYS_BACK), to: addDays(today, EVENT_DAYS_BACK) },
            { locale: ctx.locale, timeZone: DISTRICT_TIME_ZONE },
          )
          const next = occurrences.find((o) => o.endDate >= today) ?? occurrences.at(-1)
          const path = await calendarPagePath(tenant, event.calendarId, pathsFor)
          return {
            ...base,
            href: path === null ? null : linkTo(tenant, path),
            event: {
              when: next ? [next.dateLabel, next.timeLabel].filter(Boolean).join(', ') : '',
              location: event.location,
            },
          }
        }
      }
    }),
  )
}

/**
 * A published page of the event's site whose Calendar section shows its calendar (Jason,
 * 2026-11-16) — the first by path — or null. A Calendar inside Columns counts too: the choice is
 * stored in `pages_rels` under the section's path either way. The site's path index holds only its
 * published, public pages, so a draft, a staff page or another site's page is never the link.
 */
const calendarPagePath = async (
  tenant: Tenant,
  calendarId: string,
  pathsFor: (tenant: Tenant) => Promise<Map<string, string>>,
): Promise<string | null> => {
  const payload = await getPayload({ config })
  const { rows } = await (
    payload.db as unknown as {
      drizzle: { execute: (q: unknown) => Promise<{ rows: { parent_id: number }[] }> }
    }
  ).drizzle.execute(sql`
    SELECT DISTINCT parent_id FROM pages_rels
     WHERE calendars_id = ${Number(calendarId)} AND path LIKE 'layout.%'
  `)
  const paths = await pathsFor(tenant)
  const found = rows
    .map((r) => paths.get(String(r.parent_id)))
    .filter((p): p is string => p !== undefined)
    .sort()
  return found[0] ?? null
}
