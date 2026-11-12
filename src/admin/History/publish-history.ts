import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'

/**
 * A page's or announcement's history as its publishes over the last year (Jason, 2026-11-12:
 * "the page history only records when the page was published and shows the history for the last
 * year"), from its activity-log entries. PURE — the read is `history-data.ts`, the view
 * `HistoryView.tsx`.
 *
 * Each row says how it went live, who did it, when, and what was written: the publisher's
 * comment, and — for an approval — the note the school sent it with. A publish at its scheduled
 * time carries the comment it was scheduled with. Each opens the version it made, when its entry
 * names one (`versionId`, recorded since 2026-11-12; every version is kept).
 */

export const HISTORY_DAYS = 365

export type HistoryEntry = {
  id: string
  action: string
  createdAt: string
  actorLabel: string
  comment: string
  summary: string
  versionId: string | null
}

export type HistoryRow = {
  id: string
  label: string
  who: string
  when: string
  comment: string
  /** What the school wrote as it sent the change this publish approved; null for none. */
  schoolNote: string | null
  /** The version this publish made, or null when the entry does not name one. */
  href: string | null
}

const SCHEDULED = 'At its scheduled time'

const labelOf = (entry: HistoryEntry): string | null => {
  switch (entry.action) {
    case 'publish':
      return entry.summary === SCHEDULED ? 'Published at its scheduled time' : 'Published'
    case 'approve':
      return 'Approved and published'
    case 'auto-approve':
      return 'Published by auto-approval'
    case 'restore':
      return 'Restored an earlier version'
    default:
      return null
  }
}

const whenOf = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: DISTRICT_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))

export const publishHistory = (
  entries: readonly HistoryEntry[],
  { collection, id, now }: { collection: 'pages' | 'posts'; id: number | string; now: Date },
): HistoryRow[] => {
  const since = new Date(now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const rows: HistoryRow[] = []
  // Walked oldest first, so a note is given to the publish it led to and then spent.
  let schoolNote: string | null = null
  let scheduledComment = ''
  for (const entry of [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (entry.action === 'submit') {
      schoolNote = entry.comment.trim() === '' ? null : entry.comment.trim()
      continue
    }
    if (entry.action === 'schedule') {
      scheduledComment = entry.comment.trim()
      continue
    }
    const label = labelOf(entry)
    if (label === null) continue
    const comment =
      entry.comment.trim() !== ''
        ? entry.comment.trim()
        : entry.summary === SCHEDULED
          ? scheduledComment
          : ''
    if (entry.createdAt >= since) {
      rows.push({
        id: entry.id,
        label,
        who: entry.actorLabel,
        when: whenOf(entry.createdAt),
        comment,
        schoolNote,
        href:
          entry.versionId === null
            ? null
            : `/admin/collections/${collection}/${String(id)}/versions/${entry.versionId}`,
      })
    }
    schoolNote = null
    scheduledComment = ''
  }
  return rows.reverse()
}
