import type { ReviewedCollection } from '@/collections/endpoints/approve'

/**
 * The approval queue narrowed to one kind (Jason, 2026-11-12) — what each of the dashboard's
 * approval cards opens: `/admin/approvals?kind=pages` or `?kind=posts`. Anything else in the
 * address is the whole queue, so a stale or mistyped link still shows everything. PURE.
 */

export type QueueKind = ReviewedCollection

const KINDS: readonly QueueKind[] = ['pages', 'posts']

const PLURAL: Record<QueueKind, [string, string]> = {
  pages: ['page', 'pages'],
  posts: ['announcement', 'announcements'],
}

/** The kind asked for in the address, or null for the whole queue. */
export const queueKindFrom = (
  searchParams: Record<string, string | string[] | undefined> | undefined,
): QueueKind | null => {
  const kind = searchParams?.kind
  return typeof kind === 'string' && (KINDS as readonly string[]).includes(kind)
    ? (kind as QueueKind)
    : null
}

/** One kind's items, in the order they were in (oldest first), or everything. */
export const filterQueue = <T extends { collection: string }>(
  items: readonly T[],
  kind: QueueKind | null,
): T[] => (kind === null ? [...items] : items.filter((i) => i.collection === kind))

/** The queue's status line, for the whole queue (its words before) or for one kind. */
export const queueSummary = (count: number, kind: QueueKind | null): string => {
  if (kind === null) {
    if (count === 0) return 'Nothing is waiting. Every school’s changes have been dealt with.'
    return `${count} ${count === 1 ? 'submission is' : 'submissions are'} waiting, oldest first.`
  }
  const [one, many] = PLURAL[kind]
  if (count === 0) return `No ${many} are waiting.`
  return `${count} ${count === 1 ? `${one} is` : `${many} are`} waiting, oldest first.`
}

/** Words for a kind, for the cards and the queue's "showing only" line. */
export const kindWords = (kind: QueueKind): { one: string; many: string } => {
  const [one, many] = PLURAL[kind]
  return { one, many }
}
