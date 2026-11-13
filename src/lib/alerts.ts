/**
 * Alert banners (Jason, 2026-11-12) — the rules. PURE: the collection is
 * `src/collections/Alerts.ts`, the public read `src/content/alerts.ts`, the banner
 * `src/components/AlertBar/`.
 *
 * Decided: the district only posts them; templates now, English only (verified Tier 1 wording
 * comes with Phase 7, `08` §7.2); placement is sites (all / by level / chosen) × pages (every /
 * home / chosen); a visitor may close info and warning, never an emergency (`04` §3.4).
 */

export type AlertSeverity = 'info' | 'warning' | 'emergency'

export type AlertVariable = { name: string; label: string; hint: string }

export type AlertTemplate = {
  key: string
  label: string
  severity: AlertSeverity
  /** The message, with `{{name}}` blanks. */
  body: string
  variables: readonly AlertVariable[]
}

/**
 * The starter templates (Jason, 2026-11-12). THE WORDING IS A DRAFT for the district to confirm —
 * an emergency message is policy, not copy — kept in one place so that is a one-line change.
 * Phase 7 moves it to a localized `alertTemplates` collection with verified translations (`03`).
 */
/** One blank several templates share, so its hint has to suit them all. */
const DAY: AlertVariable = {
  name: 'date',
  label: 'Day',
  hint: 'For example, “Tuesday, January 14” or “today”.',
}

export const ALERT_TEMPLATES: readonly AlertTemplate[] = [
  {
    key: 'closure',
    label: 'School closure',
    severity: 'emergency',
    body: 'Schools are closed on {{date}} because of {{reason}}.',
    variables: [DAY, { name: 'reason', label: 'Reason', hint: 'For example, “snow and ice”.' }],
  },
  {
    key: 'delay',
    label: 'Delayed opening',
    severity: 'warning',
    body: 'Schools open {{delay}} late on {{date}}.',
    variables: [DAY, { name: 'delay', label: 'How late', hint: 'For example, “2 hours”.' }],
  },
  {
    key: 'early-dismissal',
    label: 'Early dismissal',
    severity: 'warning',
    body: 'Schools dismiss early, at {{time}}, on {{date}}.',
    variables: [DAY, { name: 'time', label: 'Time', hint: 'For example, “12:30 PM”.' }],
  },
  {
    key: 'lockdown',
    label: 'Lockdown or shelter in place',
    severity: 'emergency',
    body: '{{school}} is in a lockdown. Please do not come to the school. Updates will be posted here.',
    variables: [{ name: 'school', label: 'School', hint: 'The school or schools affected.' }],
  },
  {
    key: 'weather',
    label: 'Weather advisory',
    severity: 'info',
    body: 'Weather advisory: {{expected}}.',
    variables: [
      {
        name: 'expected',
        label: 'What to expect',
        hint: 'For example, “heavy rain this afternoon”.',
      },
    ],
  },
] as const

/** Every blank any template has — each one field on an alert. */
export const ALERT_VARIABLES: readonly AlertVariable[] = [
  ...new Map(ALERT_TEMPLATES.flatMap((t) => t.variables).map((v) => [v.name, v])).values(),
]

const templateFor = (key: string): AlertTemplate | undefined =>
  ALERT_TEMPLATES.find((t) => t.key === key)

type Values = Readonly<Record<string, unknown>>
const filled = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The blanks of a template still empty — the form names them. */
export const missingVariables = (key: string, values: Values): string[] =>
  (templateFor(key)?.variables ?? [])
    .filter((v) => filled(values[v.name]) === '')
    .map((v) => v.name)

/** A template's message with its blanks filled in. */
export const alertText = (key: string, values: Values): string =>
  (templateFor(key)?.body ?? '').replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    filled(values[name]),
  )

export const templateSeverity = (key: string): AlertSeverity | null =>
  templateFor(key)?.severity ?? null

// ---------------------------------------------------------------------------------------------
// Where and when an alert shows
// ---------------------------------------------------------------------------------------------

export type SchoolLevel = 'elementary' | 'middle' | 'high'

export type AlertRule = {
  startAt: string | null
  endAt: string | null
  siteScope: 'all' | 'level' | 'chosen'
  levels: readonly SchoolLevel[]
  siteIds: readonly string[]
  pageScope: 'every' | 'home' | 'chosen'
  pageIds: readonly string[]
}

export type AlertSite = { id: string; type: 'district' | 'school'; levels: readonly string[] }
/** The page being shown, or null for a screen that is not a page (the news list). */
export type AlertPage = { id: string; isHome: boolean } | null

/**
 * Whether an alert shows on this page of this site now. The district site is in "all sites" but
 * in no level: a level is a kind of school.
 */
export const alertApplies = (
  rule: AlertRule,
  site: AlertSite,
  page: AlertPage,
  now: Date,
): boolean => {
  const t = now.toISOString()
  if (rule.startAt !== null && rule.startAt > t) return false
  if (rule.endAt !== null && rule.endAt <= t) return false

  const onSite =
    rule.siteScope === 'all'
      ? true
      : rule.siteScope === 'level'
        ? site.type === 'school' && rule.levels.some((l) => site.levels.includes(l))
        : rule.siteIds.includes(site.id)
  if (!onSite) return false

  if (rule.pageScope === 'every') return true
  if (page === null) return false
  return rule.pageScope === 'home' ? page.isHome : rule.pageIds.includes(page.id)
}

/** Info and warning may be closed by a visitor for their visit; an emergency stays. */
export const isDismissible = (severity: AlertSeverity): boolean => severity !== 'emergency'

const RANK: Record<AlertSeverity, number> = { emergency: 0, warning: 1, info: 2 }

/** Emergencies first, then warnings, then info; the newest first within each. */
export const sortAlerts = <T extends { severity: AlertSeverity; startAt: string | null }>(
  alerts: readonly T[],
): T[] =>
  [...alerts].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] || (b.startAt ?? '').localeCompare(a.startAt ?? ''),
  )
