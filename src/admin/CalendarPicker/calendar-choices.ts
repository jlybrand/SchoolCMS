/**
 * A calendar block's calendars as CHECKBOXES (Jason, 2026-11-19: "swap for checkboxes") — PURE.
 * Every calendar under its site: the district first, then the schools A–Z; within a site, its own
 * (main) calendar first, then the rest A–Z. `CalendarsField` renders it.
 */

export type CalendarChoice = { id: string; name: string; imported: boolean }
export type SiteCalendars = { site: string; calendars: CalendarChoice[] }

type Row = {
  id: unknown
  name?: unknown
  isMain?: unknown
  source?: unknown
  tenant?: unknown
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const calendarsBySite = (rows: readonly Row[]): SiteCalendars[] => {
  const sites = new Map<
    string,
    { name: string; district: boolean; rows: (CalendarChoice & { main: boolean })[] }
  >()
  for (const row of rows) {
    const tenant = row.tenant
    if (typeof tenant !== 'object' || tenant === null) continue
    const site = tenant as { id?: unknown; name?: unknown; type?: unknown }
    const siteName = text(site.name)
    const name = text(row.name)
    if (siteName === '' || name === '' || row.id === undefined || row.id === null) continue
    const key = String(site.id)
    const group = sites.get(key) ?? { name: siteName, district: site.type === 'district', rows: [] }
    group.rows.push({
      id: String(row.id),
      name,
      imported: row.source === 'feed',
      main: row.isMain === true,
    })
    sites.set(key, group)
  }
  return [...sites.values()]
    .sort((a, b) => Number(b.district) - Number(a.district) || a.name.localeCompare(b.name))
    .map((group) => ({
      site: group.name,
      calendars: group.rows
        .sort((a, b) => Number(b.main) - Number(a.main) || a.name.localeCompare(b.name))
        .map(({ id, name, imported }) => ({ id, name, imported })),
    }))
}

/** Ticked in at the end, so the block keeps the order they were chosen in; unticked out. */
export const toggleCalendar = (chosen: readonly string[], id: string, on: boolean): string[] =>
  on ? (chosen.includes(id) ? [...chosen] : [...chosen, id]) : chosen.filter((c) => c !== id)
