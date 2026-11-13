import { describe, expect, it } from 'vitest'

import {
  ALERT_TEMPLATES,
  alertApplies,
  alertText,
  isDismissible,
  missingVariables,
  sortAlerts,
  type AlertRule,
} from '@/lib/alerts'

/**
 * Alert banners (Jason, 2026-11-12): district only; templates now, English only; granular
 * placement — sites (all / by level / chosen) × pages (every / home / chosen); info and warning
 * may be closed by a visitor, an emergency may not. PURE — the collection is `src/collections/
 * Alerts.ts`, the read `src/content/alerts.ts`, the banner `src/components/AlertBar/`.
 */

const NOW = new Date('2026-11-12T15:00:00.000Z')
const HOUR = 60 * 60 * 1000
const at = (h: number) => new Date(NOW.getTime() + h * HOUR).toISOString()

describe('the templates', () => {
  it('are the five starters, each with its severity', () => {
    expect(ALERT_TEMPLATES.map((t) => [t.key, t.severity])).toEqual([
      ['closure', 'emergency'],
      ['delay', 'warning'],
      ['early-dismissal', 'warning'],
      ['lockdown', 'emergency'],
      ['weather', 'info'],
    ])
  })

  it('fill their blanks into the message', () => {
    expect(alertText('closure', { date: 'Tuesday, January 14', reason: 'snow and ice' })).toBe(
      'Schools are closed on Tuesday, January 14 because of snow and ice.',
    )
    expect(alertText('delay', { date: 'Friday', delay: '2 hours' })).toBe(
      'Schools open 2 hours late on Friday.',
    )
  })

  it('a blank shared by several templates has one hint that suits them all', () => {
    const days = ALERT_TEMPLATES.flatMap((t) => t.variables).filter((v) => v.name === 'date')
    expect(new Set(days.map((v) => v.hint)).size).toBe(1)
  })

  it('name the blanks still empty, so the form can say which', () => {
    expect(missingVariables('closure', { date: 'Tuesday', reason: '  ' })).toEqual(['reason'])
    expect(missingVariables('weather', { expected: 'Heavy rain this afternoon' })).toEqual([])
  })
})

const rule = (over: Partial<AlertRule> = {}): AlertRule => ({
  startAt: null,
  endAt: null,
  siteScope: 'all',
  levels: [],
  siteIds: [],
  pageScope: 'every',
  pageIds: [],
  ...over,
})

const school = { id: '7', type: 'school' as const, levels: ['elementary'] }
const k8 = { id: '8', type: 'school' as const, levels: ['elementary', 'middle'] }
const district = { id: '1', type: 'district' as const, levels: [] }
const home = { id: '40', isHome: true }
const about = { id: '41', isHome: false }

describe('alertApplies — when', () => {
  it('shows between its start and its end', () => {
    expect(alertApplies(rule({ startAt: at(-1), endAt: at(1) }), school, home, NOW)).toBe(true)
    expect(alertApplies(rule({ startAt: at(1) }), school, home, NOW)).toBe(false)
    expect(alertApplies(rule({ endAt: at(-1) }), school, home, NOW)).toBe(false)
  })

  it('with no start shows now; with no end shows until it is taken down', () => {
    expect(alertApplies(rule(), school, home, NOW)).toBe(true)
  })
})

describe('alertApplies — which sites', () => {
  it('all sites, the district’s included', () => {
    expect(alertApplies(rule({ siteScope: 'all' }), district, home, NOW)).toBe(true)
  })

  it('by level: a school serving any chosen level, and never the district', () => {
    const middle = rule({ siteScope: 'level', levels: ['middle'] })
    expect(alertApplies(middle, k8, home, NOW)).toBe(true)
    expect(alertApplies(middle, school, home, NOW)).toBe(false)
    expect(alertApplies(middle, district, home, NOW)).toBe(false)
  })

  it('chosen sites: only those', () => {
    const chosen = rule({ siteScope: 'chosen', siteIds: ['8'] })
    expect(alertApplies(chosen, k8, home, NOW)).toBe(true)
    expect(alertApplies(chosen, school, home, NOW)).toBe(false)
  })
})

describe('alertApplies — which pages', () => {
  it('every page, a page-less screen (the news list) included', () => {
    expect(alertApplies(rule({ pageScope: 'every' }), school, null, NOW)).toBe(true)
  })

  it('home pages only', () => {
    const homes = rule({ pageScope: 'home' })
    expect(alertApplies(homes, school, home, NOW)).toBe(true)
    expect(alertApplies(homes, school, about, NOW)).toBe(false)
    expect(alertApplies(homes, school, null, NOW)).toBe(false)
  })

  it('chosen pages only', () => {
    const chosen = rule({ pageScope: 'chosen', pageIds: ['41'] })
    expect(alertApplies(chosen, school, about, NOW)).toBe(true)
    expect(alertApplies(chosen, school, home, NOW)).toBe(false)
  })
})

describe('banners', () => {
  it('a visitor may close info and warning, never an emergency', () => {
    expect(isDismissible('info')).toBe(true)
    expect(isDismissible('warning')).toBe(true)
    expect(isDismissible('emergency')).toBe(false)
  })

  it('emergencies first, then warnings, then info; newest first within each', () => {
    const sorted = sortAlerts([
      { id: 'i', severity: 'info', startAt: at(-1) },
      { id: 'e-old', severity: 'emergency', startAt: at(-5) },
      { id: 'w', severity: 'warning', startAt: at(-2) },
      { id: 'e-new', severity: 'emergency', startAt: at(-1) },
    ])
    expect(sorted.map((a) => a.id)).toEqual(['e-new', 'e-old', 'w', 'i'])
  })
})
