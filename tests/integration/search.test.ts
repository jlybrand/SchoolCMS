import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { reindexSearch } from '@/collections/search-index'
import { searchSite } from '@/content/search'
import type { ContentContext } from '@/content/types'

import { tinyPdf, tinyPng } from '../helpers/files'
import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * Site search over the real stack (Jason, 2026-11-16; Phase 6 D; ADR-14 Postgres FTS).
 *
 * Two halves. THE INDEX: the search plugin keeps one entry per published page, announcement,
 * event and document — removed when unpublished or deleted, excluded when staff-only or hidden.
 * THE QUERY: `searchSite` finds by title and words, this site's content only unless asked for
 * every site — the cross-tenant rule for this feature, proven adversarially here (`03` §6.4).
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const site = (id: number, name: string, hostname: string): ContentContext => ({
  tenant: { id: String(id), slug: hostname, name, hostname, type: 'school' },
  locale: 'en',
})
const siteA = () => site(f.tenantA, 'School A', 'a.localhost')
const siteB = () => site(f.tenantB, 'School B', 'b.localhost')

/** A word nobody else uses, so each test finds only what it made. */
let seq = 0
const word = (stem: string) => {
  seq += 1
  return `${stem}${seq}zq`
}

const words = (...paragraphs: string[]) => ({
  root: {
    type: 'root',
    children: paragraphs.map((text) => ({ type: 'paragraph', children: [{ type: 'text', text }] })),
  },
})

const page = async (
  tenant: number,
  title: string,
  body: string,
  extra: Record<string, unknown> = {},
) =>
  payload.create({
    collection: 'pages',
    data: {
      tenant,
      title,
      slug: `p-${Date.now()}-${(seq += 1)}`,
      visibility: 'public',
      layout: [{ blockType: 'richText', content: words(body) }],
      _status: 'published',
      ...extra,
    } as never,
    overrideAccess: true,
    user: f.districtAdmin,
  })

const post = async (
  tenant: number,
  board: number,
  title: string,
  extra: Record<string, unknown> = {},
) =>
  payload.create({
    collection: 'posts',
    data: {
      tenant,
      board,
      title,
      slug: `n-${Date.now()}-${(seq += 1)}`,
      body: words('Details inside.'),
      visibility: 'public',
      _status: 'published',
      ...extra,
    } as never,
    overrideAccess: true,
    user: f.districtAdmin,
  })

const entriesFor = async (collection: string, id: number | string) =>
  (
    await payload.find({
      collection: 'search',
      where: {
        and: [{ 'doc.relationTo': { equals: collection } }, { 'doc.value': { equals: id } }],
      },
      overrideAccess: true,
      depth: 0,
    })
  ).docs as unknown as { excluded: boolean; text: string; tenant: unknown }[]

const titles = async (ctx: ContentContext, query: string, scope: 'site' | 'all' = 'site') =>
  (await searchSite(ctx, { query, scope })).results.map((r) => r.title)

describe('the index', () => {
  it('a published page is indexed; a draft is not', async () => {
    const term = word('index')
    const published = await page(f.tenantA, 'Published page', term)
    const draft = await page(f.tenantA, 'Draft page', term, { _status: 'draft' })
    expect(await entriesFor('pages', published.id)).toHaveLength(1)
    expect(await entriesFor('pages', draft.id)).toHaveLength(0)
  })

  it('unpublishing or deleting removes it; staff-only or hidden marks it excluded', async () => {
    const live = await page(f.tenantA, 'Soon unpublished', word('u'))
    await payload.update({
      collection: 'pages',
      id: live.id,
      data: { _status: 'draft' } as never,
      overrideAccess: true,
      user: f.districtAdmin,
    })
    expect(await entriesFor('pages', live.id)).toHaveLength(0)

    const gone = await page(f.tenantA, 'Soon deleted', word('d'))
    await payload.delete({ collection: 'pages', id: gone.id, overrideAccess: true })
    expect(await entriesFor('pages', gone.id)).toHaveLength(0)

    const staff = await page(f.tenantA, 'Soon staff', word('s'))
    await payload.update({
      collection: 'pages',
      id: staff.id,
      data: { visibility: 'staff', _status: 'published' } as never,
      overrideAccess: true,
      user: f.districtAdmin,
    })
    expect((await entriesFor('pages', staff.id))[0]?.excluded).toBe(true)
  })

  it('a document by its title and description, with its file; an image is excluded', async () => {
    const term = word('doc')
    const doc = await payload.create({
      collection: 'resources',
      data: {
        tenant: f.tenantA,
        title: 'Bus request',
        description: term,
        remediationStatus: 'attested',
      } as never,
      file: tinyPdf(),
      overrideAccess: true,
    })
    const [entry] = (await entriesFor('resources', doc.id)) as unknown as {
      text: string
      href: string
      excluded: boolean
    }[]
    expect(entry).toMatchObject({ excluded: false })
    expect(entry!.text).toContain(term)
    expect(entry!.href).toMatch(/^\/api\/resources\/file\//)

    const image = await payload.create({
      collection: 'resources',
      data: { tenant: f.tenantA, title: 'A photo', alt: 'Students' } as never,
      file: await tinyPng(),
      overrideAccess: true,
    })
    expect((await entriesFor('resources', image.id))[0]?.excluded).toBe(true)
  })
})

describe('searchSite — this site, or every site', () => {
  it('finds a page by the words in its sections, and links to it', async () => {
    const term = word('find')
    await page(f.tenantA, 'Enrollment', `Bring a ${term} to the office.`)
    const { results, total } = await searchSite(siteA(), { query: term, scope: 'site' })
    expect(total).toBe(1)
    expect(results[0]).toMatchObject({ kind: 'page', title: 'Enrollment', siteName: null })
    expect(results[0]!.href).toMatch(/^\/p-/)
    // The snippet marks the word that matched.
    expect(results[0]!.snippet.some((part) => part.match)).toBe(true)
  })

  it('THIS SITE NEVER RETURNS ANOTHER SITE’S CONTENT; every site does, labelled', async () => {
    const term = word('iso')
    await page(f.tenantA, 'A’s page', term)
    await page(f.tenantB, 'B’s page', term)
    expect(await titles(siteA(), term)).toEqual(['A’s page'])
    expect(await titles(siteB(), term)).toEqual(['B’s page'])

    const all = await searchSite(siteA(), { query: term, scope: 'all' })
    expect(all.results.map((r) => [r.title, r.siteName]).sort()).toEqual([
      ['A’s page', null],
      ['B’s page', 'School B'],
    ])
    // Another site's page links to that site.
    const theirs = all.results.find((r) => r.siteName === 'School B')!
    expect(theirs.href).toMatch(/^https?:\/\/b\.localhost/)
  })

  it('drafts, staff-only, "Hide from site search" and images are never found', async () => {
    const term = word('never')
    await page(f.tenantA, 'Draft', term, { _status: 'draft' })
    await page(f.tenantA, 'Staff', term, { visibility: 'staff' })
    await page(f.tenantA, 'Hidden', term, { hideFromSiteSearch: true })
    await post(f.tenantA, f.boardA, 'Staff news', { visibility: 'staff', excerpt: term })
    await payload.create({
      collection: 'resources',
      data: { tenant: f.tenantA, title: term, alt: 'A photo' } as never,
      file: await tinyPng(),
      overrideAccess: true,
    })
    expect(await titles(siteA(), term, 'all')).toEqual([])
  })

  it('a title match ranks above a match in the words', async () => {
    const term = word('rank')
    await page(f.tenantA, 'Mentions it', `Somewhere down here: ${term}.`)
    await page(f.tenantA, `${term} schedule`, 'Nothing else.')
    expect(await titles(siteA(), term)).toEqual([`${term} schedule`, 'Mentions it'])
  })

  it('a shared announcement is found where it is shared, labelled and linking home — not elsewhere', async () => {
    const wide = word('wide')
    await post(f.districtTenant, f.boardDistrict, 'District-wide news', {
      excerpt: wide,
      syndication: { scope: 'district-wide' },
    })
    const found = (await searchSite(siteA(), { query: wide, scope: 'site' })).results
    expect(found.map((r) => [r.kind, r.title, r.siteName])).toEqual([
      ['post', 'District-wide news', 'District'],
    ])
    expect(found[0]!.href).toMatch(/\/news\/n-/)

    const chosen = word('chosen')
    await post(f.districtTenant, f.boardDistrict, 'For School B', {
      excerpt: chosen,
      syndication: { scope: 'selected', syndicatedTo: [f.tenantB] },
    })
    expect(await titles(siteB(), chosen)).toEqual(['For School B'])
    expect(await titles(siteA(), chosen)).toEqual([])
  })

  it('an auto-approved announcement is searchable (published inside the send)', async () => {
    await payload.update({
      collection: 'users',
      id: f.managerA.id,
      data: { autoApprove: ['posts.routine'] } as never,
      overrideAccess: true,
    })
    const term = word('auto')
    const manager = await payload.findByID({
      collection: 'users',
      id: f.managerA.id,
      overrideAccess: true,
    })
    const sent = await payload.create({
      collection: 'posts',
      data: {
        tenant: f.tenantA,
        board: f.boardA,
        title: 'Routine notice',
        visibility: 'public',
        body: words(`Thursday ${term}.`),
        reviewState: 'submitted',
      } as never,
      draft: true,
      user: manager as never,
      overrideAccess: false,
    })
    expect(sent._status).toBe('published')
    expect(await titles(siteA(), term)).toEqual(['Routine notice'])
  })

  it('an event: its details, linking to a page that shows its calendar — or no link', async () => {
    const { docs } = await payload.find({
      collection: 'calendars',
      where: { tenant: { equals: f.tenantA } },
      limit: 1,
      overrideAccess: true,
    })
    const calendar = docs[0]!.id
    const term = word('event')
    await payload.create({
      collection: 'events',
      data: {
        tenant: f.tenantA,
        calendar,
        title: 'Open house',
        location: 'Gym',
        notes: words(term),
        start: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        _status: 'published',
      } as never,
      overrideAccess: true,
      user: f.districtAdmin,
    })
    const [before] = (await searchSite(siteA(), { query: term, scope: 'site' })).results
    expect(before).toMatchObject({ kind: 'event', title: 'Open house', href: null })
    expect(before!.event).toMatchObject({ location: 'Gym' })
    expect(before!.event!.when).not.toBe('')

    const calendarPage = await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantA,
        title: 'Calendar',
        slug: `cal-${Date.now()}`,
        visibility: 'public',
        layout: [{ blockType: 'calendar', calendars: [calendar] }],
        _status: 'published',
      } as never,
      overrideAccess: true,
      user: f.districtAdmin,
    })
    const [after] = (await searchSite(siteA(), { query: term, scope: 'site' })).results
    expect(after!.href).toBe(`/${(calendarPage as { slug: string }).slug}`)
  })

  it('an event over a year ago is not found', async () => {
    const { docs } = await payload.find({
      collection: 'calendars',
      where: { tenant: { equals: f.tenantA } },
      limit: 1,
      overrideAccess: true,
    })
    const term = word('old')
    await payload.create({
      collection: 'events',
      data: {
        tenant: f.tenantA,
        calendar: docs[0]!.id,
        title: 'Long ago',
        notes: words(term),
        start: new Date(Date.now() - 400 * 86_400_000).toISOString(),
        _status: 'published',
      } as never,
      overrideAccess: true,
      user: f.districtAdmin,
    })
    expect(await titles(siteA(), term)).toEqual([])
  })

  it('an empty query searches nothing; results come ten to a page', async () => {
    expect(await searchSite(siteA(), { query: '   ', scope: 'site' })).toMatchObject({
      total: 0,
      results: [],
    })
    const term = word('many')
    for (let i = 0; i < 12; i += 1)
      await page(f.tenantA, `Page ${String(i).padStart(2, '0')}`, term)
    const first = await searchSite(siteA(), { query: term, scope: 'site' })
    const second = await searchSite(siteA(), { query: term, scope: 'site', page: 2 })
    expect(first).toMatchObject({ total: 12, page: 1, pageCount: 2 })
    expect(first.results).toHaveLength(10)
    expect(second.results).toHaveLength(2)
  })

  it('search syntax a visitor types is never an error', async () => {
    for (const q of ['"unclosed', 'a & b | !c', "'); drop table search; --", 'OR AND -']) {
      await expect(searchSite(siteA(), { query: q, scope: 'all' })).resolves.toBeTruthy()
    }
  })
})

/** `pnpm search:reindex` (2026-11-16): for content published before the index existed. */
describe('reindexSearch — the backfill', () => {
  it('rebuilds every entry from the published content, and is safe to run twice', async () => {
    const term = word('backfill')
    const live = await page(f.tenantA, 'Before the index', term)
    await page(f.tenantA, 'A draft', term, { _status: 'draft' })
    // As if the index never had it.
    await payload.delete({ collection: 'search', where: {}, overrideAccess: true })
    expect(await titles(siteA(), term)).toEqual([])

    const first = await reindexSearch(payload)
    expect(await titles(siteA(), term)).toEqual(['Before the index'])
    const second = await reindexSearch(payload)
    expect(second).toEqual(first)
    expect(await entriesFor('pages', live.id)).toHaveLength(1)
  })
})
