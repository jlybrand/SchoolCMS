import { describe, expect, it } from 'vitest'

import { HISTORY_DAYS, publishHistory, type HistoryEntry } from '@/admin/History/publish-history'

/**
 * A page's or announcement's history as its publishes over the last year (Jason, 2026-11-12),
 * built from its activity-log entries. PURE — the view is `src/admin/History/`.
 */

const NOW = new Date('2026-11-12T15:00:00.000Z')
const daysAgo = (n: number, hour = 15) => new Date(Date.UTC(2026, 10, 12 - n, hour)).toISOString()

const e = (over: Partial<HistoryEntry>): HistoryEntry => ({
  id: 'x',
  action: 'publish',
  createdAt: daysAgo(1),
  actorLabel: 'district@dd2.org',
  comment: '',
  summary: '',
  versionId: null,
  ...over,
})

const history = (entries: HistoryEntry[]) =>
  publishHistory(entries, { collection: 'pages', id: 7, now: NOW })

describe('publishHistory', () => {
  it('is a year: 365 days', () => {
    expect(HISTORY_DAYS).toBe(365)
  })

  it('keeps only publishes — not sends, requests or schedules — newest first', () => {
    const rows = history([
      e({ id: 'a', action: 'submit', createdAt: daysAgo(5) }),
      e({ id: 'b', action: 'publish', createdAt: daysAgo(4) }),
      e({ id: 'c', action: 'request-changes', createdAt: daysAgo(3) }),
      e({ id: 'd', action: 'approve', createdAt: daysAgo(2) }),
      e({ id: 'f', action: 'schedule', createdAt: daysAgo(1) }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['d', 'b'])
  })

  it('names each kind of publish', () => {
    const label = (over: Partial<HistoryEntry>) => history([e(over)])[0]?.label
    expect(label({ action: 'publish' })).toBe('Published')
    expect(label({ action: 'publish', summary: 'At its scheduled time' })).toBe(
      'Published at its scheduled time',
    )
    expect(label({ action: 'approve' })).toBe('Approved and published')
    expect(label({ action: 'auto-approve' })).toBe('Published by auto-approval')
    expect(label({ action: 'restore' })).toBe('Restored an earlier version')
  })

  it('leaves out anything older than a year', () => {
    const rows = history([
      e({ id: 'old', createdAt: daysAgo(400) }),
      e({ id: 'new', createdAt: daysAgo(10) }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['new'])
  })

  it('says who, when, and what they wrote; opens the version it made', () => {
    const [row] = history([
      e({
        id: 'p',
        createdAt: '2026-11-10T19:30:00.000Z',
        actorLabel: 'jane@dd2.org',
        comment: 'Checked with the principal.',
        versionId: '99',
      }),
    ])
    expect(row).toEqual({
      id: 'p',
      label: 'Published',
      who: 'jane@dd2.org',
      when: 'Nov 10, 2026, 2:30 PM',
      comment: 'Checked with the principal.',
      schoolNote: null,
      href: '/admin/collections/pages/7/versions/99',
    })
  })

  it('a version no longer named has no link', () => {
    expect(history([e({ versionId: null })])[0]?.href).toBeNull()
  })

  it('an approval carries the note the school sent it with', () => {
    const rows = history([
      e({ id: 's', action: 'submit', createdAt: daysAgo(3), comment: 'Spring bus times.' }),
      e({ id: 'a', action: 'approve', createdAt: daysAgo(2), comment: 'Thanks.' }),
    ])
    expect(rows[0]).toMatchObject({ comment: 'Thanks.', schoolNote: 'Spring bus times.' })
  })

  it('a note belongs to the publish it led to, not the one after', () => {
    const rows = history([
      e({ id: 's', action: 'submit', createdAt: daysAgo(5), comment: 'Old note.' }),
      e({ id: 'a1', action: 'approve', createdAt: daysAgo(4) }),
      e({ id: 'p2', action: 'publish', createdAt: daysAgo(1) }),
    ])
    expect(rows.find((r) => r.id === 'p2')?.schoolNote).toBeNull()
    expect(rows.find((r) => r.id === 'a1')?.schoolNote).toBe('Old note.')
  })

  it('a publish at its scheduled time carries the comment it was scheduled with', () => {
    const rows = history([
      e({ id: 'sc', action: 'schedule', createdAt: daysAgo(3), comment: 'For Monday.' }),
      e({ id: 'p', action: 'publish', summary: 'At its scheduled time', createdAt: daysAgo(1) }),
    ])
    expect(rows[0]).toMatchObject({
      label: 'Published at its scheduled time',
      comment: 'For Monday.',
    })
  })

  it('an announcement’s links go to its own versions', () => {
    const [row] = publishHistory([e({ versionId: '5' })], { collection: 'posts', id: 3, now: NOW })
    expect(row?.href).toBe('/admin/collections/posts/3/versions/5')
  })
})
