import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  getTestPayload,
  SEED_PASSWORD,
  seed,
  seedPosts,
  type Fixtures,
  type PostFixtures,
} from '../helpers/payload'

/**
 * The GraphQL route, through Payload's own handler (`src/app/(payload)/api/graphql/route.ts`).
 *
 * UNTIL THIS FILE, NOTHING SENT A GRAPHQL REQUEST — and the schema did not build: the
 * `autoApprove` values were `events:schedule` / `posts:routine`, and Payload's enum naming keeps
 * the `:` that GraphQL forbids (it rewrites `.` to `_`, so `events.schedule` is the enum value
 * `events_schedule`). Every "cannot … via GraphQL" claim was true only because the
 * endpoint answered nobody. A working schema OPENS the route, so the gates are asserted here:
 * the publish gate (CLAUDE.md rule 3), tenant isolation (rule 2), page history, and the users
 * collection's self-escalation refusal.
 *
 * Real `Request`s, a real JWT from `payload.login`, the test database.
 */

let payload: Payload
let f: Fixtures
let p: PostFixtures
let post: (request: Request) => Promise<Response>
const tokens: Record<string, string> = {}

type GraphQLResult = { data?: Record<string, unknown> | null; errors?: { message: string }[] }

const gql = async (query: string, as?: string): Promise<GraphQLResult> => {
  const res = await post(
    new Request('http://localhost:3000/api/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(as ? { authorization: `JWT ${tokens[as]}` } : {}),
      },
      body: JSON.stringify({ query }),
    }),
  )
  return (await res.json()) as GraphQLResult
}

/**
 * Refused BY ACCESS — Payload's Forbidden message. Any error would let a malformed query (a
 * misspelt enum, a renamed mutation) pass as a refusal.
 */
const refused = (result: GraphQLResult) =>
  (result.errors ?? []).some((e) => e.message === 'You are not allowed to perform this action.')

const login = async (email: string) => {
  const { token } = await payload.login({
    collection: 'users',
    data: { email, password: SEED_PASSWORD },
  })
  tokens[email] = token!
}

const draftOf = (id: number) =>
  payload.findByID({ collection: 'pages', id, draft: true, overrideAccess: true })

const MANAGER_A = 'manager-a@test.local'
const DISTRICT = 'district-admin@test.local'

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
  p = await seedPosts(payload, f)
  const config = (await import('@payload-config')).default
  const { GRAPHQL_POST } = await import('@payloadcms/next/routes')
  post = GRAPHQL_POST(config) as (request: Request) => Promise<Response>
  await login(MANAGER_A)
  await login(DISTRICT)
}, 120_000)

describe('the schema builds', () => {
  it('answers a query at all', async () => {
    const result = await gql('{ __typename }')
    expect(result.errors).toBeUndefined()
    expect(result.data).toEqual({ __typename: 'Query' })
  })
})

describe('publish gate over GraphQL (CLAUDE.md rule 3)', () => {
  it('a school manager cannot publish their own draft', async () => {
    const result = await gql(
      `mutation { updatePage(id: ${f.draftPageA}, data: { _status: published }) { id } }`,
      MANAGER_A,
    )
    expect(refused(result)).toBe(true)
    expect((await draftOf(f.draftPageA))._status).toBe('draft')
  })

  it('a school manager cannot create a page already published', async () => {
    const result = await gql(
      `mutation { createPage(data: { tenant: ${f.tenantA}, title: "Via GraphQL", slug: "via-graphql", pageType: "standard", visibility: "public", _status: published }) { id } }`,
      MANAGER_A,
    )
    expect(refused(result)).toBe(true)
    const { docs } = await payload.find({
      collection: 'pages',
      where: { slug: { equals: 'via-graphql' } },
      draft: true,
      overrideAccess: true,
    })
    expect(docs).toHaveLength(0)
  })

  it('a school manager can still save a draft', async () => {
    const result = await gql(
      `mutation { updatePage(id: ${f.draftPageA}, draft: true, data: { title: "Edited over GraphQL" }) { id } }`,
      MANAGER_A,
    )
    expect(result.errors).toBeUndefined()
    expect((await draftOf(f.draftPageA)).title).toBe('Edited over GraphQL')
  })
})

describe('tenant isolation over GraphQL (CLAUDE.md rule 2)', () => {
  it("a school manager reads none of another school's pages", async () => {
    const result = await gql(
      `{ Pages(draft: true, where: { tenant: { equals: ${f.tenantB} } }) { docs { id } } }`,
      MANAGER_A,
    )
    expect(result.errors).toBeUndefined()
    expect((result.data?.Pages as { docs: unknown[] }).docs).toEqual([])
  })

  it("a school manager cannot edit another school's page", async () => {
    const before = await draftOf(f.publishedPageB)
    const result = await gql(
      `mutation { updatePage(id: ${f.publishedPageB}, draft: true, data: { title: "Hijacked" }) { id } }`,
      MANAGER_A,
    )
    expect(refused(result)).toBe(true)
    expect((await draftOf(f.publishedPageB)).title).toBe(before.title)
  })

  it('an anonymous caller sees published pages only', async () => {
    const result = await gql(`{ Pages(draft: true, limit: 100) { docs { id _status } } }`)
    expect(result.errors).toBeUndefined()
    const docs = (result.data?.Pages as { docs: { id: number; _status: string }[] }).docs
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every((d) => d._status === 'published')).toBe(true)
    expect(docs.map((d) => d.id)).not.toContain(f.draftPageA)
  })
})

describe('page history over GraphQL', () => {
  it('a school manager cannot list or restore versions', async () => {
    const { docs } = await payload.findVersions({
      collection: 'pages',
      where: { parent: { equals: f.publishedPageA } },
      overrideAccess: true,
    })
    expect(docs.length).toBeGreaterThan(0)

    expect(refused(await gql(`{ versionsPages { docs { id } } }`, MANAGER_A))).toBe(true)
    expect(
      refused(await gql(`mutation { restoreVersionPage(id: ${docs[0]!.id}) { id } }`, MANAGER_A)),
    ).toBe(true)
  })

  it('a district admin can list them', async () => {
    const result = await gql(`{ versionsPages { docs { id } } }`, DISTRICT)
    expect(result.errors).toBeUndefined()
  })
})

describe('the users collection over GraphQL', () => {
  it('a school manager cannot grant themselves auto-approval', async () => {
    const result = await gql(
      `mutation { updateUser(id: ${f.managerA.id}, data: { autoApprove: [posts_routine] }) { id } }`,
      MANAGER_A,
    )
    expect(refused(result)).toBe(true)
    const user = await payload.findByID({
      collection: 'users',
      id: f.managerA.id,
      overrideAccess: true,
    })
    expect(user.autoApprove ?? []).toEqual([])
  })
})

describe('the audit trail over GraphQL', () => {
  it('a school manager cannot read it', async () => {
    expect(refused(await gql(`{ AuditEvents { docs { id } } }`, MANAGER_A))).toBe(true)
  })

  it('nobody can write it — not even the district', async () => {
    for (const who of [MANAGER_A, DISTRICT]) {
      const result = await gql(
        `mutation { createAuditEvent(data: { action: "approve", contentType: "pages", documentId: "1", actorLabel: "forged" }) { id } }`,
        who,
      )
      expect(refused(result), JSON.stringify(result.errors)).toBe(true)
    }
  })

  it('the district can read it', async () => {
    const result = await gql(`{ AuditEvents { docs { action } } }`, DISTRICT)
    expect(result.errors).toBeUndefined()
  })
})

/** Posts open the same route, so every gate pages have is asserted again (`03` §6.4). */
describe('posts over GraphQL', () => {
  const postDraft = (id: number) =>
    payload.findByID({ collection: 'posts', id, draft: true, overrideAccess: true })

  it('a school manager cannot publish their own draft post', async () => {
    const result = await gql(
      `mutation { updatePost(id: ${p.draftPostA}, data: { _status: published }) { id } }`,
      MANAGER_A,
    )
    expect(refused(result)).toBe(true)
    expect((await postDraft(p.draftPostA))._status).toBe('draft')
  })

  it("a school manager reads none of another school's posts, nor the district's draft", async () => {
    const result = await gql(`{ Posts(draft: true, limit: 100) { docs { id } } }`, MANAGER_A)
    expect(result.errors).toBeUndefined()
    const ids = (result.data?.Posts as { docs: { id: number }[] }).docs.map((d) => d.id)
    expect(ids).toContain(p.draftPostA)
    for (const id of [p.publishedPostB, p.districtWideDraft]) expect(ids).not.toContain(id)
  })

  it("a school manager cannot edit another school's post", async () => {
    const result = await gql(
      `mutation { updatePost(id: ${p.publishedPostB}, draft: true, data: { title: "Hijacked" }) { id } }`,
      MANAGER_A,
    )
    expect(refused(result)).toBe(true)
    expect((await postDraft(p.publishedPostB)).title).toBe('published post b')
  })

  it('an anonymous caller sees published, public posts only — and no syndication settings', async () => {
    const result = await gql(
      `{ Posts(draft: true, limit: 100) { docs { id _status visibility } } }`,
    )
    expect(result.errors).toBeUndefined()
    const docs = (
      result.data?.Posts as { docs: { id: number; _status: string; visibility: string }[] }
    ).docs
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every((d) => d._status === 'published' && d.visibility === 'public')).toBe(true)
    expect(docs.map((d) => d.id)).not.toContain(p.districtWideDraft)
  })

  it('a school manager cannot list or restore post versions', async () => {
    expect(refused(await gql(`{ versionsPosts { docs { id } } }`, MANAGER_A))).toBe(true)
    const { docs } = await payload.findVersions({
      collection: 'posts',
      where: { parent: { equals: p.publishedPostA } },
      overrideAccess: true,
    })
    expect(
      refused(await gql(`mutation { restoreVersionPost(id: ${docs[0]!.id}) { id } }`, MANAGER_A)),
    ).toBe(true)
  })
})

/** The district organises announcements; the route is open, so the refusals are asserted. */
describe('folders, boards and tags over GraphQL', () => {
  it('a school manager cannot make a tag, a folder or a board', async () => {
    for (const mutation of [
      `mutation { createPostTag(data: { name: "Mine" }) { id } }`,
      `mutation { createPostFolder(data: { tenant: ${f.tenantA}, name: "Mine" }) { id } }`,
      `mutation { updatePostBoard(id: ${f.boardA}, data: { name: "Renamed" }) { id } }`,
    ]) {
      const result = await gql(mutation, MANAGER_A)
      expect(refused(result), JSON.stringify(result.errors)).toBe(true)
    }
  })

  it('an anonymous caller reads none of them', async () => {
    for (const query of [
      '{ PostTags { docs { id } } }',
      '{ PostFolders { docs { id } } }',
      '{ PostBoards { docs { id } } }',
    ]) {
      const result = await gql(query)
      const docs = Object.values(result.data ?? {})[0] as { docs?: unknown[] } | null
      expect(refused(result) || (docs?.docs ?? []).length === 0).toBe(true)
    }
  })
})
