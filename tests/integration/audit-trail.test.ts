import { createLocalReq, type Payload, type TypedUser } from 'payload'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { approvePage, latestVersionToken } from '@/collections/endpoints/approve-page'

import { getTestPayload, isDenied, seed, SEED_PASSWORD, type Fixtures } from '../helpers/payload'

/**
 * The audit trail against the real stack (`04` §8, `09` §6).
 *
 * `tests/unit/lib/audit.test.ts` owns which writes produce an entry. This proves the entries
 * land: through the real routes (the queue's approve, a restore, a delete), with the right
 * actor and school, that nobody can alter the record by any API, and that a change whose entry
 * cannot be written does not happen.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

afterEach(() => {
  vi.restoreAllMocks()
})

const entriesFor = async (contentType: string, documentId: number | string) =>
  (
    await payload.find({
      collection: 'audit-events',
      where: {
        and: [
          { contentType: { equals: contentType } },
          { documentId: { equals: String(documentId) } },
        ],
      },
      sort: 'createdAt',
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })
  ).docs

const actions = async (contentType: string, id: number | string) =>
  (await entriesFor(contentType, id)).map((e) => e.action)

let seq = 0
const newPage = async (extra: Record<string, unknown> = {}) => {
  seq += 1
  return payload.create({
    collection: 'pages',
    data: {
      tenant: f.tenantA,
      title: `Audit page ${seq}`,
      slug: `audit-${Date.now()}-${seq}`,
      pageType: 'standard',
      visibility: 'public',
      ...extra,
    },
    draft: true,
    user: f.managerA,
    overrideAccess: false,
  })
}

const asUser = (user: TypedUser) => createLocalReq({ user }, payload)

describe('the approval loop leaves a complete record', () => {
  it('send, send back, resend, approve — four entries, in order, by the right people', async () => {
    const page = await newPage({ reviewState: 'submitted' })

    await payload.update({
      collection: 'pages',
      id: page.id,
      data: { reviewState: 'changes-requested', reviewNote: 'Route 4 moved.' },
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await payload.update({
      collection: 'pages',
      id: page.id,
      data: { title: `${page.title} (fixed)`, reviewState: 'submitted' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    const seen = await latestVersionToken(payload, page.id)
    expect(await approvePage(await asUser(f.districtAdmin), page.id, seen)).toEqual({ ok: true })

    const entries = await entriesFor('pages', page.id)
    expect(entries.map((e) => e.action)).toEqual(['submit', 'request-changes', 'submit', 'approve'])
    expect(entries.map((e) => e.actor)).toEqual([
      f.managerA.id,
      f.districtAdmin.id,
      f.managerA.id,
      f.districtAdmin.id,
    ])
    expect(entries.every((e) => e.tenant === f.tenantA)).toBe(true)
    expect(entries[1]!.summary).toBe('Route 4 moved.')
    expect(entries[3]!.actorLabel).toBe('district-admin@test.local')
    expect(entries.every((e) => e.autoApproved === false)).toBe(true)
  })

  it('edits and autosaves in between add nothing', async () => {
    const page = await newPage()
    await payload.update({
      collection: 'pages',
      id: page.id,
      data: { title: `${page.title} edited` },
      draft: true,
      autosave: true,
      user: f.managerA,
      overrideAccess: false,
    })
    expect(await actions('pages', page.id)).toEqual([])
  })

  it('a refused publish records nothing', async () => {
    const page = await newPage()
    await isDenied(() =>
      payload.update({
        collection: 'pages',
        id: page.id,
        data: { _status: 'published' },
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(await actions('pages', page.id)).toEqual([])
  })
})

describe('district actions', () => {
  it('a direct publish, a restore and a delete are each recorded', async () => {
    const page = await newPage()
    await payload.update({
      collection: 'pages',
      id: page.id,
      data: { _status: 'published' },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const { docs } = await payload.findVersions({
      collection: 'pages',
      where: { parent: { equals: page.id } },
      sort: 'createdAt',
      overrideAccess: true,
    })
    // Only a version that was published can be restored.
    const published = docs.find((d) => d.version._status === 'published')!
    await payload.restoreVersion({
      collection: 'pages',
      id: published.id,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await payload.delete({
      collection: 'pages',
      id: page.id,
      user: f.districtAdmin,
      overrideAccess: false,
    })

    expect(await actions('pages', page.id)).toEqual(['publish', 'restore', 'delete'])
    const [deleted] = (await entriesFor('pages', page.id)).slice(-1)
    expect(deleted!.documentTitle).toBe(page.title)
  })
})

describe('user and grant changes', () => {
  it('create, a login, a grant, a role change and a delete are each recorded', async () => {
    const user = await payload.create({
      collection: 'users',
      data: {
        email: 'audited@test.local',
        password: SEED_PASSWORD,
        name: 'Audited Person',
        roles: ['school-manager'],
        tenants: [{ tenant: f.tenantA }],
      },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await payload.login({
      collection: 'users',
      data: { email: 'audited@test.local', password: SEED_PASSWORD },
    })
    await payload.update({
      collection: 'users',
      id: user.id,
      data: { autoApprove: ['posts.routine'] },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await payload.update({
      collection: 'users',
      id: user.id,
      data: { autoApprove: [], roles: ['district-admin'] },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    await payload.delete({
      collection: 'users',
      id: user.id,
      user: f.districtAdmin,
      overrideAccess: false,
    })

    const entries = await entriesFor('users', user.id)
    expect(entries.map((e) => e.action)).toEqual([
      'user-create',
      'login',
      'grant-change',
      'user-change',
      'grant-change',
      'user-delete',
    ])
    // The person signing in is the actor of their own login. They have since been DELETED, so
    // the link to them is gone (ON DELETE SET NULL) — and the recorded address still says who.
    expect(entries[1]).toMatchObject({ actor: null, actorLabel: 'audited@test.local' })
    expect(entries[2]!.summary).toBe('Auto-approval: none → Posts: routine posts')
    expect(entries[3]!.summary).toBe('Roles: school-manager → district-admin')
    expect(
      entries.filter((e) => e.action !== 'login').every((e) => e.actor === f.districtAdmin.id),
    ).toBe(true)
    expect(JSON.stringify(entries)).not.toContain(SEED_PASSWORD)
  })
})

describe('sign-ins', () => {
  it('a failed sign-in records nothing; a successful one records exactly one login', async () => {
    const before = (await entriesFor('users', f.managerB.id)).filter((e) => e.action === 'login')
    await isDenied(() =>
      payload.login({
        collection: 'users',
        data: { email: 'manager-b@test.local', password: 'wrong-password-entirely' },
      }),
    )
    await payload.login({
      collection: 'users',
      data: { email: 'manager-b@test.local', password: SEED_PASSWORD },
    })
    const after = (await entriesFor('users', f.managerB.id)).filter((e) => e.action === 'login')
    expect(after.length - before.length).toBe(1)
    expect(after.at(-1)).toMatchObject({ actor: f.managerB.id, actorLabel: 'manager-b@test.local' })
  })
})

describe('the record cannot be altered', () => {
  const anEntry = async () => {
    const page = await newPage({ reviewState: 'submitted' })
    return (await entriesFor('pages', page.id))[0]!
  }

  it.each([
    ['a district admin', () => f.districtAdmin],
    ['a school manager', () => f.managerA],
  ])('%s cannot create, edit or delete an entry', async (_label, who) => {
    const entry = await anEntry()
    const user = who()
    expect(
      await isDenied(() =>
        payload.create({
          collection: 'audit-events',
          data: { action: 'approve', contentType: 'pages', documentId: '1', actorLabel: 'forged' },
          user,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
    expect(
      await isDenied(() =>
        payload.update({
          collection: 'audit-events',
          id: entry.id,
          data: { summary: 'rewritten' },
          user,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
    expect(
      await isDenied(() =>
        payload.delete({ collection: 'audit-events', id: entry.id, user, overrideAccess: false }),
      ),
    ).toBe(true)
    const still = await payload.findByID({
      collection: 'audit-events',
      id: entry.id,
      overrideAccess: true,
    })
    expect(still.summary ?? '').toBe(entry.summary ?? '')
  })

  it('only a district admin can read it', async () => {
    await anEntry()
    expect(
      (
        await payload.find({
          collection: 'audit-events',
          user: f.districtAdmin,
          overrideAccess: false,
        })
      ).docs.length,
    ).toBeGreaterThan(0)
    for (const user of [f.managerA, f.systemSync]) {
      expect(
        await isDenied(() =>
          payload.find({ collection: 'audit-events', user, overrideAccess: false }),
        ),
      ).toBe(true)
    }
  })
})

describe('never an invisible change (`04` §4.3)', () => {
  it('if the entry cannot be written, the change does not happen', async () => {
    const page = await newPage()
    const create = payload.create.bind(payload)
    vi.spyOn(payload, 'create').mockImplementation(((args: { collection: string }) => {
      if (args.collection === 'audit-events') throw new Error('audit store unavailable')
      return create(args as never)
    }) as never)

    const failed = await isDenied(() =>
      payload.update({
        collection: 'pages',
        id: page.id,
        data: { reviewState: 'submitted' },
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(failed).toBe(true)
    vi.restoreAllMocks()

    const stored = await payload.findByID({
      collection: 'pages',
      id: page.id,
      draft: true,
      overrideAccess: true,
    })
    expect(stored.reviewState).not.toBe('submitted')
    expect(await actions('pages', page.id)).toEqual([])
  })
})
