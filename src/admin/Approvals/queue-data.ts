import type { Payload, PayloadRequest } from 'payload'

import { isDistrictAdmin, relationshipIdOf } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import type { VersionToken } from '@/access/approval'
import { latestVersion, type ReviewedCollection } from '@/collections/endpoints/approve'
import { sentComments } from '@/collections/sent-comments'

import { diffPage, diffPost, type PageDiff } from './page-diff'
import { describeWait, DISTRICT_TIME_ZONE, type Wait } from '@/lib/queue-age'

/**
 * Everything the queue renders for each waiting page or announcement, read once on the server.
 * One queue, oldest first, whatever was sent (`04` §4.2).
 *
 * The list runs AS THE REVIEWER (`overrideAccess: false`), so only a district admin's access
 * yields all 28 schools. Each item carries the TOKEN of the version it diffs; that token is
 * what approve checks (`src/access/approval.ts`), so the reviewer can only ever publish the
 * version on their screen.
 *
 * `live` is the page's main row when it is published. Payload writes draft saves to versions
 * only, so the main row of a published page holds the live content; an unpublished page has
 * no live version and diffs as new.
 */

const LIMIT = 50

export type QueueItem = {
  id: number | string
  collection: ReviewedCollection
  /** What the school sent, in words: "page" or "announcement". Events skip approval. */
  noun: 'page' | 'announcement'
  title: string
  school: string
  submitter: string
  wait: Wait
  diff: PageDiff
  token: VersionToken
  /** What the school wrote as it sent this (Jason, 2026-11-12); empty for nothing. */
  comment: string
}

type Doc = Record<string, unknown>

const NOUN: Record<ReviewedCollection, QueueItem['noun']> = {
  pages: 'page',
  posts: 'announcement',
}

const titleOf = (doc: Doc, noun: QueueItem['noun'] = 'page'): string =>
  typeof doc.title === 'string' && doc.title.trim() !== '' ? doc.title : `Untitled ${noun}`

/** id -> display string, for a handful of related rows read as the platform. */
const namesFor = async (
  req: PayloadRequest,
  collection: 'tenants' | 'users' | 'pages' | 'post-boards' | 'post-tags' | 'resources',
  ids: string[],
  name: (doc: Doc) => string,
): Promise<Map<string, string>> => {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const { docs } = await req.payload.find({
    collection,
    where: { id: { in: unique } },
    limit: unique.length,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return new Map(docs.map((doc) => [String(doc.id), name(doc as unknown as Doc)]))
}

const withParentTitle = (doc: Doc, titles: Map<string, string>): Doc => {
  const parent = relationshipIdOf(doc.parent as never)
  return parent === null
    ? doc
    : { ...doc, parent: { id: parent, title: titles.get(parent) ?? null } }
}

/** Not events: they skip approval (Jason, 2026-11-11). */
const REVIEWED: readonly ReviewedCollection[] = ['pages', 'posts']

/** A post's board, tags and image as `{ id, title }`, so the diff names them (`diffPost`). */
const withPostNames = (
  doc: Doc | null,
  boards: Map<string, string>,
  tags: Map<string, string>,
  images: Map<string, string>,
): Doc | null => {
  if (!doc) return null
  const board = relationshipIdOf(doc.board as never)
  const image = relationshipIdOf(doc.heroImage as never)
  const tagIds = (Array.isArray(doc.tags) ? doc.tags : [])
    .map((t) => relationshipIdOf(t as never))
    .filter((t): t is string => t !== null)
  return {
    ...doc,
    board: board === null ? null : { id: board, title: boards.get(board) ?? null },
    tags: tagIds.map((id) => ({ id, title: tags.get(id) ?? null })),
    heroImage: image === null ? null : { id: image, title: images.get(image) ?? null },
  }
}

type Waiting = { collection: ReviewedCollection; doc: Doc }

export const loadQueue = async (req: PayloadRequest, now = new Date()): Promise<QueueItem[]> => {
  const waitingIn = async (collection: ReviewedCollection) =>
    (
      await req.payload.find({
        collection,
        where: { reviewState: { equals: 'submitted' } },
        draft: true,
        sort: 'submittedAt',
        limit: LIMIT,
        depth: 0,
        overrideAccess: false,
        user: req.user,
        req,
      })
    ).docs.map((doc) => ({ collection, doc: doc as unknown as Doc }))

  // Oldest first across both: the queue is worked from the longest wait.
  const waiting = (await Promise.all(REVIEWED.map(waitingIn)))
    .flat()
    .sort((a, b) => String(a.doc.submittedAt ?? '').localeCompare(String(b.doc.submittedAt ?? '')))
    .slice(0, LIMIT)

  return buildItems(req, waiting, now)
}

/**
 * One waiting page or announcement as the queue shows it — for the review panel on the document
 * itself (Jason, 2026-11-12), so approving there sends the same token the queue would. Null for
 * anyone but the district, for something not waiting, and for something that is not there.
 */
export const loadQueueItem = async (
  req: PayloadRequest,
  collection: ReviewedCollection,
  id: number | string,
  now = new Date(),
): Promise<QueueItem | null> => {
  if (!isDistrictAdmin(req.user as AuthUser | null)) return null
  const { docs } = await req.payload.find({
    collection,
    where: { and: [{ id: { equals: id } }, { reviewState: { equals: 'submitted' } }] },
    draft: true,
    limit: 1,
    depth: 0,
    overrideAccess: false,
    user: req.user,
    req,
  })
  const doc = docs[0] as unknown as Doc | undefined
  if (!doc) return null
  return (await buildItems(req, [{ collection, doc }], now))[0] ?? null
}

/** The diff, names, wait and version token for each waiting document, in the order given. */
const buildItems = async (
  req: PayloadRequest,
  waiting: readonly Waiting[],
  now: Date,
): Promise<QueueItem[]> => {
  const rows = await Promise.all(
    waiting.map(async ({ collection, doc: draft }) => {
      const id = draft.id as number | string
      const [latest, main] = await Promise.all([
        latestVersion(req.payload, collection, id, req),
        req.payload.findByID({
          collection,
          id,
          draft: false,
          depth: 0,
          overrideAccess: true,
          req,
          // Deleted between the list and this read: skip it, never fail the whole queue.
          disableErrors: true,
        }),
      ])
      if (!latest || !main) return null
      const live =
        (main as unknown as Doc)._status === 'published' ? (main as unknown as Doc) : null
      return { id, collection, latest, live }
    }),
  )
  const present = rows.filter((row): row is NonNullable<typeof row> => row !== null)

  const ids = (pick: (row: (typeof present)[number]) => unknown) =>
    present
      .map(pick)
      .map((v) => relationshipIdOf(v as never))
      .filter((v): v is string => v !== null)

  const posts = present.filter((r) => r.collection === 'posts')
  const postRefs = (key: 'board' | 'tags' | 'heroImage') =>
    posts
      .flatMap((r) => [r.latest.version[key], r.live?.[key]])
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .map((v) => relationshipIdOf(v as never))
      .filter((v): v is string => v !== null)

  const [schools, submitters, parents, boards, tagNames, imageNames, comments] = await Promise.all([
    namesFor(
      req,
      'tenants',
      ids((r) => r.latest.version.tenant),
      (d) => String(d.name ?? d.id),
    ),
    namesFor(
      req,
      'users',
      ids((r) => r.latest.version.submittedBy),
      (d) =>
        typeof d.name === 'string' && d.name !== ''
          ? `${d.name} (${String(d.email)})`
          : String(d.email),
    ),
    namesFor(
      req,
      'pages',
      present
        .filter((r) => r.collection === 'pages')
        .flatMap((r) => [r.latest.version.parent, r.live?.parent])
        .map((v) => relationshipIdOf(v as never))
        .filter((v): v is string => v !== null),
      (d) => titleOf(d),
    ),
    namesFor(req, 'post-boards', postRefs('board'), (d) => String(d.title ?? d.name ?? d.id)),
    namesFor(req, 'post-tags', postRefs('tags'), (d) => String(d.name ?? d.id)),
    namesFor(req, 'resources', postRefs('heroImage'), (d) => String(d.title ?? d.filename ?? d.id)),
    sentComments(
      req,
      present.map((r) => ({ collection: r.collection, id: r.id })),
    ),
  ])

  return present.map(({ id, collection, latest, live }) => {
    const proposed = latest.version
    const noun = NOUN[collection]
    const name = (map: Map<string, string>, value: unknown, fallback: string) => {
      const key = relationshipIdOf(value as never)
      return (key && map.get(key)) || fallback
    }
    return {
      id,
      collection,
      noun,
      title: titleOf(proposed, noun),
      school: name(schools, proposed.tenant, 'Unknown school'),
      submitter: name(submitters, proposed.submittedBy, 'Unknown sender'),
      wait: describeWait(proposed.submittedAt, now, DISTRICT_TIME_ZONE),
      diff:
        collection === 'posts'
          ? diffPost(
              withPostNames(live, boards, tagNames, imageNames),
              withPostNames(proposed, boards, tagNames, imageNames)!,
            )
          : diffPage(
              live ? withParentTitle(live, parents) : null,
              withParentTitle(proposed, parents),
            ),
      token: latest.token,
      comment: comments.get(`${collection}/${String(id)}`) ?? '',
    }
  })
}
