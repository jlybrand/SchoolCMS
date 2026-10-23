import type { Payload, PayloadRequest } from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import type { VersionToken } from '@/access/approval'
import { latestVersion } from '@/collections/endpoints/approve-page'

import { diffPage, type PageDiff } from './page-diff'
import { describeWait, DISTRICT_TIME_ZONE, type Wait } from '@/lib/queue-age'

/**
 * Everything the queue renders for each waiting page, read once on the server.
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
  title: string
  school: string
  submitter: string
  wait: Wait
  diff: PageDiff
  token: VersionToken
}

type Doc = Record<string, unknown>

const titleOf = (doc: Doc): string =>
  typeof doc.title === 'string' && doc.title.trim() !== '' ? doc.title : 'Untitled page'

/** id -> display string, for a handful of related rows read as the platform. */
const namesFor = async (
  req: PayloadRequest,
  collection: 'tenants' | 'users' | 'pages',
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

/** How many pages wait, counted as `user` — only a district admin's access sees every school. */
export const countWaiting = async (
  payload: Payload,
  user: PayloadRequest['user'],
): Promise<number> => {
  const { totalDocs } = await payload.count({
    collection: 'pages',
    where: { reviewState: { equals: 'submitted' } },
    overrideAccess: false,
    user,
  })
  return totalDocs
}

export const loadQueue = async (req: PayloadRequest, now = new Date()): Promise<QueueItem[]> => {
  const { docs: waiting } = await req.payload.find({
    collection: 'pages',
    where: { reviewState: { equals: 'submitted' } },
    draft: true,
    // Oldest first: the queue is worked from the longest wait.
    sort: 'submittedAt',
    limit: LIMIT,
    depth: 0,
    overrideAccess: false,
    user: req.user,
    req,
  })

  const rows = await Promise.all(
    waiting.map(async (draft) => {
      const id = draft.id
      const [latest, main] = await Promise.all([
        latestVersion(req.payload, id, req),
        req.payload.findByID({
          collection: 'pages',
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
      return { id, latest, live }
    }),
  )
  const present = rows.filter((row): row is NonNullable<typeof row> => row !== null)

  const ids = (pick: (row: (typeof present)[number]) => unknown) =>
    present
      .map(pick)
      .map((v) => relationshipIdOf(v as never))
      .filter((v): v is string => v !== null)

  const [schools, submitters, parents] = await Promise.all([
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
      [...ids((r) => r.latest.version.parent), ...ids((r) => r.live?.parent)],
      titleOf,
    ),
  ])

  return present.map(({ id, latest, live }) => {
    const proposed = latest.version
    const name = (map: Map<string, string>, value: unknown, fallback: string) => {
      const key = relationshipIdOf(value as never)
      return (key && map.get(key)) || fallback
    }
    return {
      id,
      title: titleOf(proposed),
      school: name(schools, proposed.tenant, 'Unknown school'),
      submitter: name(submitters, proposed.submittedBy, 'Unknown sender'),
      wait: describeWait(proposed.submittedAt, now, DISTRICT_TIME_ZONE),
      diff: diffPage(
        live ? withParentTitle(live, parents) : null,
        withParentTitle(proposed, parents),
      ),
      token: latest.token,
    }
  })
}
