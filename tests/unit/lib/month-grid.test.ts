import { describe, expect, it } from 'vitest'

import { monthGrid, monthRange, monthsFrom, spreadByDay } from '@/lib/month-grid'

/**
 * The calendar block's grid view (Jason, 2026-11-11): a month as weeks of days, like a paper
 * calendar. Pure — the resolve pass builds it, the block only renders it.
 */

describe('monthsFrom', () => {
  it('lists months from the one holding today, across a year end', () => {
    expect(monthsFrom('2026-11-11', 3)).toEqual(['2026-11', '2026-12', '2027-01'])
  })
})

describe('monthRange', () => {
  it('is the first to the last day of the month', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })
})

describe('monthGrid', () => {
  it('weeks start on Sunday; days outside the month are empty', () => {
    // November 2026 starts on a Sunday and has 30 days → 5 weeks.
    const weeks = monthGrid('2026-11')
    expect(weeks).toHaveLength(5)
    expect(weeks[0]).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
    ])
    expect(weeks[4]).toEqual(['2026-11-29', '2026-11-30', null, null, null, null, null])
  })

  it('pads the first week before the 1st', () => {
    // December 2026 starts on a Tuesday.
    expect(monthGrid('2026-12')[0]).toEqual([
      null,
      null,
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
    ])
  })

  it('every week has seven days', () => {
    for (const month of ['2026-01', '2026-02', '2027-05', '2027-08']) {
      for (const week of monthGrid(month)) expect(week).toHaveLength(7)
    }
  })
})

describe('spreadByDay', () => {
  const o = (key: string, startDate: string, endDate = startDate) => ({ key, startDate, endDate })

  it('puts each event on every day it covers, in the order given', () => {
    const byDay = spreadByDay([o('a', '2026-12-04'), o('b', '2026-12-03', '2026-12-05')])
    expect(byDay.get('2026-12-03')?.map((x) => x.key)).toEqual(['b'])
    expect(byDay.get('2026-12-04')?.map((x) => x.key)).toEqual(['a', 'b'])
    expect(byDay.get('2026-12-05')?.map((x) => x.key)).toEqual(['b'])
    expect(byDay.get('2026-12-06')).toBeUndefined()
  })

  it('caps a very long event so one entry cannot fill a year', () => {
    const byDay = spreadByDay([o('long', '2026-01-01', '2030-01-01')], 62)
    expect(byDay.size).toBe(62)
  })
})
