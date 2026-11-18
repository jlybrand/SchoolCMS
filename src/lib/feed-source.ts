/**
 * Where an imported calendar's events come from, said plainly (Jason, 2026-11-18: "This calendar
 * is a feed from …") — PURE, and safe in the browser (unlike `feed-sync.ts`, which hashes with
 * Node). Google and Outlook by name; anywhere else, the host — NEVER the full address, which can
 * carry a private token (Google's secret iCal address, a `?key=`).
 */

const KNOWN: readonly [RegExp, string][] = [
  [/(^|\.)google\.com$/, 'Google Calendar'],
  [/(^|\.)(outlook\.com|office365\.com|outlook\.office\.com|live\.com)$/, 'Outlook'],
]

export const feedSource = (address: unknown): string => {
  if (typeof address !== 'string' || address.trim() === '') return 'another calendar'
  let host: string
  try {
    host = new URL(address.trim()).hostname.toLowerCase()
  } catch {
    return 'another calendar'
  }
  if (host === '') return 'another calendar'
  for (const [pattern, name] of KNOWN) if (pattern.test(host)) return name
  return host.replace(/^www\./, '')
}

/** The line shown beside an imported calendar wherever events are added. */
export const feedNote = (address: unknown): string =>
  `This calendar is a feed from ${feedSource(address)}. Its events are added there, not here.`
