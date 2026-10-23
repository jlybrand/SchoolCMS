/**
 * The submitter's email when the district decides (`04` §4.5: "Submitter → email on approve or
 * changes-requested").
 *
 * Pure: which writes are outcomes, what the email says, where its links go. Sending is
 * `src/collections/hooks/notify-review-outcome.ts`, through Payload's own `sendEmail`.
 *
 * There is deliberately no email to the DISTRICT per submission — `04` §4.5 says that becomes
 * noise and gets filtered. The district gets a daily digest instead (a later slice).
 *
 * Wording follows the school plane's rule (`04` §2.1): no "draft", no "collection", no
 * "tenant". The reader is a school manager who last logged in months ago.
 */

export type ReviewOutcome = 'approved' | 'changes-requested'

type ReviewSnapshot = { reviewState?: unknown; _status?: unknown } | null | undefined

/**
 * The outcome a write represents, comparing the page before and after it. Only a page that WAS
 * waiting can have one — so autosaves, district edits, sends and resends never email anyone.
 */
export const reviewOutcome = (
  before: ReviewSnapshot,
  after: ReviewSnapshot,
): ReviewOutcome | null => {
  if (before?.reviewState !== 'submitted') return null
  if (after?.reviewState === 'changes-requested') return 'changes-requested'
  const cleared = after?.reviewState === null || after?.reviewState === undefined
  if (after?._status === 'published' && cleared) return 'approved'
  return null
}

/**
 * The approved page's public address: the server URL's scheme and port, the school's hostname.
 * Locally `http://a.localhost:3000/…`; in production `https://{school}.…/…`.
 */
export const publicUrlFor = (serverUrl: string, hostname: string, path: string): string => {
  let url: URL
  try {
    url = new URL(serverUrl)
  } catch {
    url = new URL('https://placeholder.invalid')
    url.port = ''
  }
  url.hostname = hostname
  url.pathname = path
  url.search = ''
  url.hash = ''
  return url.toString()
}

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Line breaks would let a title inject headers into the message. */
export const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim()

export type OutcomeEmailInput = {
  outcome: ReviewOutcome
  title: string
  school: string
  /** The live page — used when approved. */
  pageUrl: string
  /** The page form — used when changes are requested. */
  editUrl: string
  note?: string | null
}

export type Email = { subject: string; text: string; html: string }

export const SIGN_OFF = 'The district web team'

/** The HTML shell every platform email shares. */
export const emailDocument = (heading: string, body: string): string =>
  [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>',
    escapeHtml(heading),
    '</title></head>',
    '<body style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #14171c;">',
    `<h1 style="font-size: 20px;">${escapeHtml(heading)}</h1>`,
    body,
    `<p>${SIGN_OFF}</p>`,
    '</body></html>',
  ].join('')

export const outcomeEmail = (input: OutcomeEmailInput): Email => {
  const title = oneLine(input.title)
  const school = oneLine(input.school)

  if (input.outcome === 'approved') {
    const heading = 'Your page is live'
    return {
      subject: `${heading}: ${title}`,
      text: [
        `The district approved your changes to “${title}” on ${school}’s website. They are live now:`,
        '',
        input.pageUrl,
        '',
        SIGN_OFF,
      ].join('\n'),
      html: emailDocument(
        heading,
        `<p>The district approved your changes to “${escapeHtml(title)}” on ${escapeHtml(school)}’s website. They are live now.</p>` +
          `<p><a href="${escapeHtml(input.pageUrl)}">See “${escapeHtml(title)}” on the website</a></p>`,
      ),
    }
  }

  const note = (input.note ?? '').trim()
  const heading = 'Changes needed'
  return {
    subject: `${heading}: ${title}`,
    text: [
      `The district looked at your changes to “${title}” on ${school}’s website and asked for a few changes before it goes live:`,
      '',
      ...note.split('\n').map((line) => `  ${line}`),
      '',
      'Make the changes, then press “Send for approval” again:',
      '',
      input.editUrl,
      '',
      'Nothing you wrote has been lost.',
      '',
      SIGN_OFF,
    ].join('\n'),
    html: emailDocument(
      heading,
      `<p>The district looked at your changes to “${escapeHtml(title)}” on ${escapeHtml(school)}’s website and asked for a few changes before it goes live:</p>` +
        `<blockquote style="margin: 0 0 16px; padding-left: 12px; border-left: 4px solid #4d5563;">${escapeHtml(note).replace(/\n/g, '<br>')}</blockquote>` +
        `<p>Make the changes, then press “Send for approval” again. Nothing you wrote has been lost.</p>` +
        `<p><a href="${escapeHtml(input.editUrl)}">Open “${escapeHtml(title)}” to make the changes</a></p>`,
    ),
  }
}
