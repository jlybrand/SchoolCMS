import { kindWords, type QueueKind } from '@/admin/Approvals/queue-filter'
import { DAY, describeWait, localDay, OVERDUE_BUSINESS_DAYS } from '@/lib/queue-age'

/**
 * The district dashboard's decisions (`04` §3.1; layout decided by Jason, 2026-11-04): the
 * approval queue in a line, what needs freshening, and recent activity from the audit trail.
 * Pure — `src/admin/Dashboard/` reads the data and renders these.
 *
 * Above them, banners for what needs acting on now (`needsAttention`). Panels for sync status,
 * live alerts and the work queues join when their modules exist: a panel that leads nowhere
 * teaches the district the dashboard lies.
 */

// ---------------------------------------------------------------------------------------------
// ⓪ Needs attention — banners over the panels (Jason, 2026-11-12)
// ---------------------------------------------------------------------------------------------

/** A calendar whose last feed copy failed (`feedError`, `src/jobs/calendar-feeds.ts`). */
export type FeedFailure = { id: number | string; name: string; site: string; error: string }

export type AttentionItem = { type: 'warning' | 'error'; text: string; href: string }

/**
 * What the district has to act on, one banner each, each one click from where it is fixed:
 * overdue approvals (a warning — work waiting) then failed calendar feeds (an error — something
 * broken), by site and calendar. Empty when there is nothing, so the section is not drawn.
 *
 * A feed failure shows only on that calendar's own form otherwise, so nobody would see it.
 */
export const needsAttention = ({
  overdue,
  feedFailures,
}: {
  overdue: number
  feedFailures: readonly FeedFailure[]
}): AttentionItem[] => {
  const items: AttentionItem[] = []
  if (overdue > 0) {
    items.push({
      type: 'warning',
      text:
        overdue === 1
          ? `1 submission is overdue. It has waited more than ${OVERDUE_BUSINESS_DAYS} school days.`
          : `${overdue} submissions are overdue. They have waited more than ${OVERDUE_BUSINESS_DAYS} school days.`,
      href: '/admin/approvals',
    })
  }
  const byPlace = [...feedFailures].sort(
    (a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name),
  )
  for (const feed of byPlace) {
    const problem =
      feed.error.trim() !== '' ? feed.error.trim() : 'It will be tried again within the hour.'
    items.push({
      type: 'error',
      text: `${feed.site} · ${feed.name}: the calendar feed could not be copied. ${problem}`,
      href: `/admin/collections/calendars/${String(feed.id)}`,
    })
  }
  return items
}

// ---------------------------------------------------------------------------------------------
// ① Approvals
// ---------------------------------------------------------------------------------------------

export type ApprovalSummary = { count: number; text: string; overdue: number }

/**
 * Count, the oldest wait, and how many are overdue — in the queue's own words (`describeWait`),
 * so the dashboard and the queue never disagree about an age.
 */
export const approvalSummary = (
  waiting: readonly { submittedAt?: unknown }[],
  now: Date,
  timeZone: string,
): ApprovalSummary => {
  if (waiting.length === 0) {
    return { count: 0, text: 'Nothing is waiting for approval.', overdue: 0 }
  }

  const sent = waiting
    .map((w) => (typeof w.submittedAt === 'string' ? w.submittedAt : null))
    .filter((at): at is string => at !== null && !Number.isNaN(new Date(at).getTime()))
    .sort()
  const overdue = sent.filter((at) => describeWait(at, now, timeZone).overdue).length
  const oldest = sent[0] ? describeWait(sent[0], now, timeZone).label : null
  // "Sent 7 days ago" → "sent 7 days ago", to sit inside the sentence.
  const when = oldest ? oldest.charAt(0).toLowerCase() + oldest.slice(1) : null

  const count = waiting.length
  const text =
    count === 1
      ? `1 submission is waiting.${when ? ` It was ${when}.` : ''}`
      : `${count} submissions are waiting.${when ? ` The oldest was ${when}.` : ''}`
  return { count, text, overdue }
}

export type ApprovalCard = { id: string; title: string; href: string; label: string }

/**
 * One card per kind (Payload's `Card`, Jason 2026-11-12), each opening the queue at that kind
 * (`src/admin/Approvals/queue-filter.ts`). Both kinds always, so the cards do not appear and
 * vanish as the queue empties. `label` names the card's link — Payload's Card puts its link over
 * the whole card with no text of its own.
 */
export const approvalCards = (waiting: readonly { collection?: unknown }[]): ApprovalCard[] =>
  (['pages', 'posts'] as const satisfies readonly QueueKind[]).map((kind) => {
    const { one, many } = kindWords(kind)
    const count = waiting.filter((w) => w.collection === kind).length
    return {
      id: `approval-card-${kind}`,
      title: count === 0 ? `No ${many} waiting` : `${count} ${count === 1 ? one : many} waiting`,
      href: `/admin/approvals?kind=${kind}`,
      label:
        count === 0
          ? `Open the ${many} part of the approval queue`
          : `Open the ${count} ${count === 1 ? one : many} waiting for approval`,
    }
  })

// ---------------------------------------------------------------------------------------------
// ② Needs freshening
// ---------------------------------------------------------------------------------------------

/** `04` §3.1 item 2: "tenants whose content has not changed in 90+ days". */
export const STALE_DAYS = 90

const isStale = (iso: string | undefined, now: Date): boolean =>
  iso === undefined || now.getTime() - new Date(iso).getTime() > STALE_DAYS * DAY

const lastChanged = (iso: string, timeZone: string): string =>
  `Last changed ${new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso))}`

export type StaleSite = { id: string; name: string; last: string }

/**
 * Sites whose newest published page or announcement is older than `STALE_DAYS` — and sites with
 * nothing published at all, first. Longest-unchanged first after that: they need it most.
 * `last` is site id → the newest published `updatedAt`.
 */
export const staleSites = (
  sites: readonly { id: string; name: string }[],
  last: ReadonlyMap<string, string>,
  now: Date,
  timeZone: string,
): StaleSite[] =>
  sites
    .filter((site) => isStale(last.get(site.id), now))
    .sort((a, b) => (last.get(a.id) ?? '').localeCompare(last.get(b.id) ?? ''))
    .map((site) => {
      const at = last.get(site.id)
      return {
        id: site.id,
        name: site.name,
        last: at === undefined ? 'Nothing published yet' : lastChanged(at, timeZone),
      }
    })

export type KeyPageKind = 'Home page'

/**
 * The key page `04` §3.1 names that a page can be found by: the front page (a top-level page
 * slugged "home" — see the tenant-root decision). Contact and calendar pages were page types until
 * Jason, 2026-11-04; a calendar becomes a component, and pages carrying one join this check then.
 */
export const keyPageKind = (page: { slug?: unknown; parent?: unknown }): KeyPageKind | null =>
  page.slug === 'home' && (page.parent === null || page.parent === undefined) ? 'Home page' : null

export type KeyPage = {
  id: number | string
  site: string
  title: string
  kind: KeyPageKind
  updatedAt: string
}
export type StaleKeyPage = KeyPage & { href: string; last: string }

/** Key pages whose published version is older than `STALE_DAYS`, oldest first. */
export const staleKeyPages = (
  pages: readonly KeyPage[],
  now: Date,
  timeZone: string,
): StaleKeyPage[] =>
  pages
    .filter((page) => isStale(page.updatedAt, now))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .map((page) => ({
      ...page,
      href: `/admin/collections/pages/${page.id}`,
      last: lastChanged(page.updatedAt, timeZone),
    }))

// ---------------------------------------------------------------------------------------------
// ③ Recent activity
// ---------------------------------------------------------------------------------------------

/** What the activity panel shows: content, not sign-ins or accounts (Jason, 2026-11-04). */
export const CONTENT_ACTIONS = [
  'submit',
  'request-changes',
  'approve',
  'auto-approve',
  'publish',
  'schedule',
  'expire',
  'restore',
  'delete',
] as const

type ContentAction = (typeof CONTENT_ACTIONS)[number]
const isContentAction = (action: unknown): action is ContentAction =>
  (CONTENT_ACTIONS as readonly unknown[]).includes(action)

const NOUNS: Readonly<Record<string, string>> = {
  pages: 'page',
  posts: 'announcement',
  events: 'event',
}

export type ActivityInput = {
  action: unknown
  contentType: unknown
  documentId: unknown
  documentTitle: unknown
  actorLabel: unknown
  /** The site's name, or null for the district's own. */
  school: string | null
  createdAt: unknown
  autoApproved?: unknown
}

/**
 * What happened, in one word and a color — Payload's `Pill` (Jason, 2026-11-12), for scanning the
 * panel. The sentence says the same in full, so the color is never the only cue (WCAG 1.4.1).
 * `style` is one of Payload's pill styles: live is green, waiting on someone amber, gone red.
 */
export type ActivityTag = { label: string; style: 'success' | 'warning' | 'error' | 'light-gray' }

const TAGS: Record<ContentAction, ActivityTag> = {
  publish: { label: 'Published', style: 'success' },
  approve: { label: 'Approved', style: 'success' },
  'auto-approve': { label: 'Auto-approved', style: 'success' },
  submit: { label: 'Sent', style: 'warning' },
  'request-changes': { label: 'Sent back', style: 'warning' },
  delete: { label: 'Deleted', style: 'error' },
  schedule: { label: 'Scheduled', style: 'light-gray' },
  expire: { label: 'Expired', style: 'light-gray' },
  restore: { label: 'Restored', style: 'light-gray' },
}

export type ActivityRow = {
  school: string
  sentence: string
  tag: ActivityTag
  /** Null when there is nothing to open — the item was deleted. */
  href: string | null
  when: string
}

const ago = (iso: unknown, now: Date, timeZone: string): string => {
  const at = typeof iso === 'string' ? new Date(iso) : null
  if (!at || Number.isNaN(at.getTime())) return ''
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`
  if (localDay(now, timeZone) - localDay(at, timeZone) === DAY) return 'Yesterday'
  const sameYear =
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(at) ===
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(now)
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(at)
}

/** One audit entry as a line of the activity panel; null for anything that is not content. */
export const activityRow = (
  event: ActivityInput,
  now: Date,
  timeZone: string,
): ActivityRow | null => {
  if (!isContentAction(event.action)) return null

  const type = typeof event.contentType === 'string' ? event.contentType : ''
  const noun = NOUNS[type] ?? 'item'
  const title =
    typeof event.documentTitle === 'string' && event.documentTitle !== ''
      ? event.documentTitle
      : `untitled ${noun}`
  const who =
    typeof event.actorLabel === 'string' && event.actorLabel !== '' ? event.actorLabel : 'Someone'
  const thing = `the ${noun} “${title}”`

  const sentence: Record<ContentAction, string> = {
    submit: `${who} sent ${thing} for approval`,
    'request-changes': `${who} sent ${thing} back for changes`,
    approve: `${who} approved ${thing}`,
    'auto-approve': `The ${noun} “${title}” by ${who} was published by auto-approval`,
    publish: `${who} published ${thing}`,
    schedule: `${who} scheduled ${thing} to go live later`,
    expire: `The ${noun} “${title}” expired and was taken off the website`,
    restore: `${who} restored an earlier version of ${thing}`,
    delete: `${who} deleted ${thing}`,
  }

  const id = typeof event.documentId === 'string' || typeof event.documentId === 'number'
  return {
    school: event.school ?? 'District',
    sentence: sentence[event.action],
    tag: TAGS[event.action],
    href:
      event.action === 'delete' || !id || !NOUNS[type]
        ? null
        : `/admin/collections/${type}/${String(event.documentId)}`,
    when: ago(event.createdAt, now, timeZone),
  }
}
