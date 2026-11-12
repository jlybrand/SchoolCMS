import type { PayloadRequest } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

import { HISTORY_DAYS, publishHistory, type HistoryEntry, type HistoryRow } from './publish-history'

/** What a publish's row is built from — its sends and schedules lend their notes. */
const ACTIONS = ['submit', 'schedule', 'publish', 'approve', 'auto-approve', 'restore']

/** A little past the year, so a note sent just before it reaches the publish inside it. */
const LOOKBACK_DAYS = HISTORY_DAYS + 30

/**
 * A page's or announcement's publishes over the last year, from the activity log (Jason,
 * 2026-11-12). Null for anyone but the district: page history is theirs (2026-10-27). Read as the
 * platform once that is checked — the activity log is the district's to read anyway.
 */
export const loadPublishHistory = async (
  req: PayloadRequest,
  collection: 'pages' | 'posts',
  id: number | string,
  now = new Date(),
): Promise<HistoryRow[] | null> => {
  if (!isDistrictAdmin(req.user as AuthUser | null)) return null
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { docs } = await req.payload.find({
    collection: 'audit-events',
    where: {
      and: [
        { contentType: { equals: collection } },
        { documentId: { equals: String(id) } },
        { action: { in: ACTIONS } },
        { createdAt: { greater_than_equal: since } },
      ],
    },
    sort: 'createdAt',
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const entries: HistoryEntry[] = (docs as unknown as Record<string, unknown>[]).map((doc) => ({
    id: String(doc.id),
    action: String(doc.action ?? ''),
    createdAt: String(doc.createdAt ?? ''),
    actorLabel: typeof doc.actorLabel === 'string' ? doc.actorLabel : 'Someone',
    comment: typeof doc.comment === 'string' ? doc.comment : '',
    summary: typeof doc.summary === 'string' ? doc.summary : '',
    versionId: typeof doc.versionId === 'string' && doc.versionId !== '' ? doc.versionId : null,
  }))
  return publishHistory(entries, { collection, id, now })
}
