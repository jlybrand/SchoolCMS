/**
 * The district's mail about the approval queue (`04` §4.5, §5).
 *
 * - A **daily digest** of what is waiting — instead of an email per submission, which `04` §4.5
 *   says becomes noise and gets filtered. Weekday mornings only, and only when something waits.
 * - An **overdue alert** when a page passes the threshold (`OVERDUE_BUSINESS_DAYS`), sent
 *   to the district admins opted in to alerts (`alertRecipients`), so a second approver sees it
 *   (`04` §5) unless the district has chosen otherwise.
 *
 * Overdue is counted in whole school days (`src/lib/queue-age.ts`), so a page can only become
 * overdue at midnight; the first moment anyone can act on it is the next morning's run, which is
 * when the alert goes. "Newly" overdue means overdue now and not 24 hours ago, so the alert is
 * sent once and the digest carries the marker after that. Stateless: nothing records what was
 * sent, and a run that is missed costs one morning's email, never a duplicate.
 *
 * Pure. The scheduled task that reads the queue and sends is `src/jobs/district-digest.ts`.
 */

import { describeWait, OVERDUE_BUSINESS_DAYS } from '@/lib/queue-age'
import { emailDocument, escapeHtml, oneLine, type Email } from '@/lib/review-emails'

export const DIGEST_HOUR = 7

export type WaitingPage = { title: string; school: string; sentAt: unknown }

const DAY = 24 * 60 * 60 * 1000

/** Weekday and hour on the district's clock. */
const localTime = (at: Date, timeZone: string): { weekday: string; hour: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at)
  return {
    weekday: parts.find((p) => p.type === 'weekday')?.value ?? '',
    hour: Number(parts.find((p) => p.type === 'hour')?.value),
  }
}

/** True for any moment inside the digest hour on a weekday, district time. */
export const isDigestTime = (at: Date, timeZone: string): boolean => {
  const { weekday, hour } = localTime(at, timeZone)
  return weekday !== 'Sat' && weekday !== 'Sun' && hour === DIGEST_HOUR
}

export const newlyOverdue = <T extends WaitingPage>(
  pages: T[],
  now: Date,
  timeZone: string,
): T[] => {
  const dayBefore = new Date(now.getTime() - DAY)
  return pages.filter(
    (p) =>
      describeWait(p.sentAt, now, timeZone).overdue &&
      !describeWait(p.sentAt, dayBefore, timeZone).overdue,
  )
}

type MailInput = { pages: WaitingPage[]; now: Date; timeZone: string; queueUrl: string }

const pagesCount = (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`

type Line = { text: string; html: string }

const line = (p: WaitingPage, now: Date, timeZone: string, markOverdue: boolean): Line => {
  const wait = describeWait(p.sentAt, now, timeZone)
  const title = oneLine(p.title) || 'Untitled page'
  const school = oneLine(p.school)
  const marker = markOverdue && wait.overdue ? ' (overdue)' : ''
  return {
    text: `- ${title} — ${school} — ${wait.label}${marker}`,
    html: `<li>${escapeHtml(title)} — ${escapeHtml(school)} — ${escapeHtml(wait.label)}${marker ? ' <strong>(overdue)</strong>' : ''}</li>`,
  }
}

const compose = (
  subject: string,
  heading: string,
  intro: string,
  lines: Line[],
  queueUrl: string,
): Email => ({
  subject,
  text: [intro, '', ...lines.map((l) => l.text), '', 'Open the approval queue:', '', queueUrl].join(
    '\n',
  ),
  html: emailDocument(
    heading,
    `<p>${escapeHtml(intro)}</p>` +
      `<ul>${lines.map((l) => l.html).join('')}</ul>` +
      `<p><a href="${escapeHtml(queueUrl)}">Open the approval queue</a></p>`,
  ),
})

export const digestEmail = ({ pages, now, timeZone, queueUrl }: MailInput): Email | null => {
  if (pages.length === 0) return null
  const overdue = pages.filter((p) => describeWait(p.sentAt, now, timeZone).overdue).length
  const heading = `${pagesCount(pages.length)} waiting for approval`
  return compose(
    overdue > 0 ? `${heading} (${overdue} overdue)` : heading,
    heading,
    'These pages are waiting in the approval queue this morning, oldest first:',
    pages.map((p) => line(p, now, timeZone, true)),
    queueUrl,
  )
}

export const overdueAlertEmail = ({ pages, now, timeZone, queueUrl }: MailInput): Email | null => {
  if (pages.length === 0) return null
  const heading = `Overdue: ${pagesCount(pages.length)} waiting more than ${OVERDUE_BUSINESS_DAYS} school days`
  return compose(
    heading,
    heading,
    `${pages.length === 1 ? 'This page has' : 'These pages have'} now waited more than ${OVERDUE_BUSINESS_DAYS} school days for approval. While it waits, the school’s website stays out of date.`,
    pages.map((p) => line(p, now, timeZone, false)),
    queueUrl,
  )
}

/** Everything one run sends to each district admin: nothing, the digest, or digest + alert. */
export const districtMail = ({
  pages,
  at,
  timeZone,
  queueUrl,
}: Omit<MailInput, 'now'> & { at: Date }): Email[] => {
  if (!isDigestTime(at, timeZone)) return []
  const input = { now: at, timeZone, queueUrl }
  return [
    digestEmail({ ...input, pages }),
    overdueAlertEmail({ ...input, pages: newlyOverdue(pages, at, timeZone) }),
  ].filter((email): email is Email => email !== null)
}

export type AlertCandidate = { email?: unknown; receivesAlerts?: unknown }

/**
 * Which district admins get the district's mail (Jason, 2026-10-23). A per-person setting,
 * `users.receivesAlerts` — never a role or a permission: every admin keeps equal rights.
 *
 * Opted in unless the setting is explicitly `false`, so an admin with nothing stored keeps
 * today's behaviour. If NOBODY is opted in, everyone is mailed (`fallback: true`): an approval
 * queue nobody hears about goes stale, which is the failure this platform exists to prevent.
 */
export const alertRecipients = (
  admins: readonly AlertCandidate[],
): { to: string[]; fallback: boolean } => {
  const usable = admins
    .map((a) => ({
      email: typeof a.email === 'string' ? a.email.trim() : '',
      on: a.receivesAlerts !== false,
    }))
    .filter((a) => a.email !== '')
  const unique = (list: { email: string }[]) => [...new Set(list.map((a) => a.email))]
  const chosen = unique(usable.filter((a) => a.on))
  if (chosen.length > 0 || usable.length === 0) return { to: chosen, fallback: false }
  return { to: unique(usable), fallback: true }
}
