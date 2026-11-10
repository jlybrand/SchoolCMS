import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { composeExistingPages } from '@/lib/compose-existing-pages'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * Every page composed (Jason, 2026-11-04): the one-off conversion of the pages that exist, against
 * real Payload with its drafts and versions. The mapping itself is `tests/unit/lib/compose-page.test.ts`.
 *
 * What must survive it: what is live stays live and reads the same; a school's change waiting
 * for approval stays waiting, with its own words, its submitter and its review state; nobody is
 * emailed; running it again does nothing.
 */

let payload: Payload
let f: Fixtures
const made: number[] = []

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

afterAll(async () => {
  for (const id of made.reverse()) {
    await payload.delete({ collection: 'pages', id, overrideAccess: true }).catch(() => null)
  }
})

const words = (text: string) => ({
  root: {
    type: 'root',
    direction: null,
    format: '',
    indent: 0,
    version: 1,
    children: [{ type: 'paragraph', version: 1, children: [{ type: 'text', text, version: 1 }] }],
  },
})

const textOf = (layout: unknown): string[] =>
  ((layout ?? []) as { blockType: string; content?: unknown }[]).map((row) =>
    row.blockType === 'richText'
      ? (JSON.stringify(row.content).match(/"text":"([^"]*)"/)?.[1] ?? '')
      : row.blockType,
  )

const live = (id: number) =>
  payload.findByID({ collection: 'pages', id, draft: false, depth: 0, overrideAccess: true })
const latest = (id: number) =>
  payload.findByID({ collection: 'pages', id, draft: true, depth: 0, overrideAccess: true })

let seq = 0

/**
 * A page as pages were stored BEFORE every page was composed: words in `body`, type `standard`.
 * Payload can no longer write that shape — `composeBodyOnWrite` converts any write — so the page
 * is made normally and then put back in the old shape through the database adapter, underneath
 * every hook, as rows written before this change already sit. `latest` is the newest version
 * (a waiting draft); `live`, when given, is the published row.
 */
const toLegacy = async (
  id: number,
  {
    live: liveBody,
    latest: latestBody,
    layout = [],
  }: { live?: unknown; latest: unknown; layout?: unknown[] },
) => {
  const old = { pageType: 'standard', layout }
  if (liveBody !== undefined) {
    await payload.db.updateOne({ collection: 'pages', id, data: { ...old, body: liveBody } })
  }
  const { docs } = await payload.db.findVersions({
    collection: 'pages',
    where: { parent: { equals: id } },
    sort: '-updatedAt',
    limit: 1,
    pagination: false,
  })
  const newest = docs[0] as unknown as Record<string, unknown> & {
    id: number | string
    version: Record<string, unknown>
  }
  // The whole version row — `parent`, `latest` and all — with its content in the old shape.
  await payload.db.updateVersion({
    collection: 'pages',
    id: newest.id,
    versionData: { ...newest, version: { ...newest.version, ...old, body: latestBody } } as never,
  })
}

/** A page in School A, stored the old way with `body` words. */
const standardPage = async (
  body: unknown,
  status: 'published' | 'draft',
  layout: unknown[] = [],
) => {
  seq += 1
  const data = {
    tenant: f.tenantA,
    title: `Compose ${seq}`,
    slug: `compose-${Date.now()}-${seq}`,
    pageType: 'composed' as const,
    visibility: 'public' as const,
  }
  const page =
    status === 'draft'
      ? await payload.create({
          collection: 'pages',
          data: { ...data, _status: 'draft' },
          draft: true,
          user: f.districtAdmin,
          overrideAccess: true,
        })
      : await payload.create({
          collection: 'pages',
          data: { ...data, _status: 'published' },
          user: f.districtAdmin,
          overrideAccess: true,
        })
  const id = page.id as number
  made.push(id)
  await toLegacy(id, {
    ...(status === 'published' ? { live: body } : {}),
    latest: body,
    layout,
  })
  return id
}

const run = (ids: number[]) => composeExistingPages(payload, { ids })

describe('composeExistingPages', () => {
  it('a live page: its words become a Text section, and it stays live', async () => {
    const id = await standardPage(words('Welcome to the library.'), 'published')

    expect((await run([id])).converted).toEqual([id])

    const now = await live(id)
    expect(now._status).toBe('published')
    expect(now.pageType).toBe('composed')
    expect(textOf(now.layout)).toEqual(['Welcome to the library.'])
    expect(now.body ?? null).toBeNull()
    expect((await latest(id))._status).toBe('published')
  })

  it('a school’s change waiting for approval stays waiting — its words, its submitter, its state', async () => {
    const id = await standardPage(words('Open 8 to 4.'), 'published')
    await payload.update({
      collection: 'pages',
      id,
      data: { body: words('Open 8 to 5.') as never, reviewState: 'submitted' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    await toLegacy(id, { live: words('Open 8 to 4.'), latest: words('Open 8 to 5.') })
    const send = vi.spyOn(payload, 'sendEmail')

    await run([id])

    const shown = await live(id)
    expect(shown._status).toBe('published')
    expect(textOf(shown.layout)).toEqual(['Open 8 to 4.'])

    const waiting = await latest(id)
    expect(waiting._status).toBe('draft')
    expect(waiting.pageType).toBe('composed')
    expect(textOf(waiting.layout)).toEqual(['Open 8 to 5.'])
    expect(waiting.body ?? null).toBeNull()
    expect(waiting.reviewState).toBe('submitted')
    const submitter = waiting.submittedBy as number | { id: number } | null
    expect(typeof submitter === 'object' && submitter ? submitter.id : submitter).toBe(
      f.managerA.id,
    )

    expect(send).not.toHaveBeenCalled()
    send.mockRestore()
  })

  it('a page never published stays a draft', async () => {
    const id = await standardPage(words('Coming soon.'), 'draft')
    await run([id])
    const page = await latest(id)
    expect(page._status).toBe('draft')
    expect(textOf(page.layout)).toEqual(['Coming soon.'])
  })

  it('the words go above the sections the page already had', async () => {
    const id = await standardPage(words('Read on.'), 'published', [
      { id: 'legacy-divider', blockType: 'divider' },
    ])
    await run([id])
    expect(textOf((await live(id)).layout)).toEqual(['Read on.', 'divider'])
  })

  it('a page with no words is only marked composed', async () => {
    const id = await standardPage(null, 'published')
    await run([id])
    const page = await live(id)
    expect(page.pageType).toBe('composed')
    expect(page.layout ?? []).toEqual([])
  })

  it('running it again changes nothing', async () => {
    const id = await standardPage(words('Once.'), 'published')
    await run([id])
    const before = await latest(id)
    expect((await run([id])).converted).toEqual([])
    const after = await latest(id)
    expect(after.updatedAt).toBe(before.updatedAt)
    expect(textOf(after.layout)).toEqual(['Once.'])
  })
})
