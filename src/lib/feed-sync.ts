import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

import type { FeedEvent } from './ical-parse'

/**
 * Feed calendars (Jason, 2026-11-11): the district gives a calendar an iCal or Google address and
 * an hourly job (`src/jobs/calendar-feeds.ts`) keeps its events in step with it. These are the
 * pure decisions under that job.
 *
 * FETCHING A TYPED-IN ADDRESS FROM THE SERVER IS A REQUEST FORGERY RISK. Only `https`, no
 * credentials, never a name or address on the server's own network — checked here on the
 * address, and again by the job on every address the name RESOLVES to (`isPublicAddress`), and on
 * every redirect.
 */

export type FeedUrlCheck = { ok: true; url: string } | { ok: false; error: string }

const NOT_PUBLIC = 'Use a calendar address on the public internet.'

const privateV4 = (ip: string): boolean => {
  const [a, b] = ip.split('.').map(Number) as [number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

/** Whether a resolved address is on the public internet — never the server's own network. */
export const isPublicAddress = (ip: string): boolean => {
  const version = isIP(ip)
  if (version === 4) return !privateV4(ip)
  if (version !== 6) return false
  const lower = ip.toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped) return !privateV4(mapped[1]!)
  if (lower === '::' || lower === '::1') return false
  // fc00::/7 unique local, fe80::/10 link local, ff00::/8 multicast.
  return !/^(f[cd]|fe[89ab]|ff)/.test(lower)
}

/** The address a district admin typed, checked; `webcal://` is read as `https://`. */
export const checkFeedUrl = (raw: unknown): FeedUrlCheck => {
  const typed = typeof raw === 'string' ? raw.trim().replace(/^webcal:\/\//i, 'https://') : ''
  let url: URL
  try {
    url = new URL(typed)
  } catch {
    return { ok: false, error: 'Paste the calendar’s full address, starting with https://.' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'The address must start with https:// (or webcal://).' }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: 'Use the calendar’s public address — one without a password in it.' }
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return { ok: false, error: NOT_PUBLIC }
  }
  if (isIP(host) !== 0 && !isPublicAddress(host)) return { ok: false, error: NOT_PUBLIC }
  return { ok: true, url: url.toString() }
}

/** What a stored feed event looks like, for comparing: everything the calendar shows. */
export const fingerprintOf = (event: FeedEvent): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        event.title,
        event.location,
        event.description,
        event.allDay,
        event.start,
        event.end,
      ]),
    )
    .digest('hex')

export type StoredFeedEvent = {
  id: number | string
  feedUid: string | null
  fingerprint: string | null
}

export type FeedSyncPlan = {
  create: FeedEvent[]
  update: { id: number | string; event: FeedEvent }[]
  remove: (number | string)[]
}

/**
 * What one fetch changes. Matched by `feedUid` (the occurrence's stable id): new → create,
 * changed → update in place, gone → remove. A stored event with no `feedUid` is not the feed's and
 * is never touched.
 */
export const planFeedSync = (
  stored: readonly StoredFeedEvent[],
  incoming: readonly FeedEvent[],
): FeedSyncPlan => {
  const byUid = new Map(
    stored.filter((s) => s.feedUid !== null).map((s) => [s.feedUid as string, s]),
  )
  const seen = new Set<string>()
  const plan: FeedSyncPlan = { create: [], update: [], remove: [] }
  for (const event of incoming) {
    if (seen.has(event.uid)) continue
    seen.add(event.uid)
    const existing = byUid.get(event.uid)
    if (!existing) plan.create.push(event)
    else if (existing.fingerprint !== fingerprintOf(event)) {
      plan.update.push({ id: existing.id, event })
    }
  }
  for (const [uid, existing] of byUid) if (!seen.has(uid)) plan.remove.push(existing.id)
  return plan
}

const lexicalText = (text: string) => ({
  type: 'text',
  version: 1,
  text,
  format: 0,
  mode: 'normal',
  style: '',
  detail: 0,
})

const lexicalParagraph = (text: string) => ({
  type: 'paragraph',
  version: 1,
  direction: null,
  format: '',
  indent: 0,
  children: [lexicalText(text)],
})

/** A plain-text description as Notes: one paragraph a non-empty line. Null for none. */
const notesOf = (description: string | null) => {
  const lines = (description ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (lines.length === 0) return null
  return {
    root: {
      type: 'root',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children: lines.map(lexicalParagraph),
    },
  }
}

/** A feed event as the `events` row the job stores: published, on its calendar and site. */
export const feedEventData = (
  event: FeedEvent,
  { tenant, calendar }: { tenant: number | string; calendar: number | string },
) => ({
  tenant,
  calendar,
  title: event.title,
  location: event.location,
  start: event.start,
  end: event.end,
  allDay: event.allDay,
  repeat: 'none' as const,
  repeatUntil: null,
  notes: notesOf(event.description),
  feedUid: event.uid,
  feedFingerprint: fingerprintOf(event),
  _status: 'published' as const,
})
