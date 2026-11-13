import { describe, expect, it } from 'vitest'

import {
  onScheduleStep,
  SCHEDULE_CRON,
  STEP_REFUSAL,
  joinLocal,
  splitLocal,
  stepErrors,
  stepTimes,
  timeLabel,
} from '@/lib/schedule-step'

/**
 * Scheduled times come in five-minute steps (Jason, 2026-11-13). The schedule job runs on the
 * five minutes, so a time on a step goes live within seconds of it; 08:41 waited until 08:45.
 */

describe('the schedule and the picker share one step', () => {
  it('runs the job on the same five minutes the picker offers', () => {
    expect(SCHEDULE_CRON).toBe('*/5 * * * *')
  })
})

describe('onScheduleStep', () => {
  it('accepts a time on the five minutes', () => {
    expect(onScheduleStep(new Date('2026-11-13T13:40:00.000Z'))).toBe(true)
    expect(onScheduleStep(new Date('2026-11-13T13:45:00.000Z'))).toBe(true)
    expect(onScheduleStep(new Date('2026-11-13T00:00:00.000Z'))).toBe(true)
  })

  it('refuses a time between steps', () => {
    expect(onScheduleStep(new Date('2026-11-13T13:41:00.000Z'))).toBe(false)
    expect(onScheduleStep(new Date('2026-11-13T13:44:00.000Z'))).toBe(false)
  })

  it('refuses stray seconds — the job would still wait for the next step', () => {
    expect(onScheduleStep(new Date('2026-11-13T13:40:30.000Z'))).toBe(false)
  })
})

describe('stepErrors', () => {
  it('names each date set between steps', () => {
    expect(
      stepErrors({
        publishAt: '2026-11-13T13:41:00.000Z',
        expiresAt: '2026-11-20T13:40:00.000Z',
        featuredUntil: '2026-11-15T09:02:00.000Z',
      }),
    ).toEqual({ publishAt: STEP_REFUSAL, featuredUntil: STEP_REFUSAL })
  })

  it('leaves unset and unreadable dates to their own checks', () => {
    expect(stepErrors({ publishAt: null, expiresAt: 'nonsense' })).toEqual({})
  })
})

describe('the day-and-time picker (a day box and a Time list — 2026-11-13)', () => {
  it('lists every five minutes of the day, and nothing between', () => {
    const times = stepTimes()
    expect(times).toHaveLength(288)
    expect(times[0]).toBe('00:00')
    expect(times[1]).toBe('00:05')
    expect(times.at(-1)).toBe('23:55')
    expect(times).not.toContain('08:41')
  })

  it('names a time the way people read one', () => {
    expect(timeLabel('00:00', 'en-US')).toBe('12:00 AM')
    expect(timeLabel('09:05', 'en-US')).toBe('9:05 AM')
    expect(timeLabel('13:30', 'en-US')).toBe('1:30 PM')
  })

  it('splits and joins the value the dialogs already keep', () => {
    expect(splitLocal('2026-11-13T08:40')).toEqual({ day: '2026-11-13', time: '08:40' })
    expect(joinLocal('2026-11-13', '08:40')).toBe('2026-11-13T08:40')
    expect(splitLocal('')).toEqual({ day: '', time: '' })
    expect(joinLocal('', '')).toBe('')
  })

  it('keeps half a choice, which reads as no date until both are made', () => {
    expect(joinLocal('2026-11-13', '')).toBe('2026-11-13T')
    expect(splitLocal('2026-11-13T')).toEqual({ day: '2026-11-13', time: '' })
    expect(Number.isNaN(new Date(joinLocal('2026-11-13', '')).getTime())).toBe(true)
    expect(Number.isNaN(new Date(joinLocal('', '08:40')).getTime())).toBe(true)
  })
})
