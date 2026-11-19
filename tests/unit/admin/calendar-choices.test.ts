import { describe, expect, it } from 'vitest'

import { calendarsBySite, toggleCalendar } from '@/admin/CalendarPicker/calendar-choices'

/**
 * A calendar block's calendars as CHECKBOXES (Jason, 2026-11-19: "swap for checkboxes"): every
 * calendar, under its site — the district first, then the schools A–Z, each site's own calendar
 * first. PURE; the field only renders it.
 */

const row = (
  id: number,
  name: string,
  site: { id: number; name: string; type?: string },
  extra: { isMain?: boolean; source?: string } = {},
) => ({ id, name, tenant: site, ...extra })

const district = { id: 1, name: 'DD2 District', type: 'district' }
const schoolB = { id: 3, name: 'School B', type: 'school' }
const schoolA = { id: 2, name: 'Alston Middle', type: 'school' }

describe('calendarsBySite', () => {
  it('the district first, then the schools A–Z; each site’s own calendar first, then A–Z', () => {
    const groups = calendarsBySite([
      row(7, 'Athletics', schoolB, { source: 'feed' }),
      row(3, 'School B', schoolB, { isMain: true }),
      row(2, 'Alston Middle', schoolA, { isMain: true }),
      row(5, 'Board meetings', district),
      row(1, 'DD2 District', district, { isMain: true }),
      row(6, 'Arts', schoolB),
    ])
    expect(groups.map((g) => g.site)).toEqual(['DD2 District', 'Alston Middle', 'School B'])
    expect(groups[2]!.calendars.map((c) => c.name)).toEqual(['School B', 'Arts', 'Athletics'])
    expect(groups[0]!.calendars.map((c) => c.id)).toEqual(['1', '5'])
  })

  it('says which are imported, so the district knows a feed is in the mix', () => {
    const [group] = calendarsBySite([row(7, 'Athletics', schoolB, { source: 'feed' })])
    expect(group!.calendars[0]).toEqual({ id: '7', name: 'Athletics', imported: true })
  })

  it('a calendar whose site is not populated, or has no name, is left out', () => {
    expect(calendarsBySite([{ id: 9, name: 'Lost', tenant: 4 }, row(8, '  ', schoolB)])).toEqual([])
  })
})

describe('toggleCalendar', () => {
  it('ticking adds it at the end — the block keeps the order they were chosen in', () => {
    expect(toggleCalendar(['3', '1'], '7', true)).toEqual(['3', '1', '7'])
  })

  it('unticking removes it and keeps the rest in order', () => {
    expect(toggleCalendar(['3', '1', '7'], '1', false)).toEqual(['3', '7'])
  })

  it('ticking one already in is a no-op', () => {
    expect(toggleCalendar(['3'], '3', true)).toEqual(['3'])
  })
})
