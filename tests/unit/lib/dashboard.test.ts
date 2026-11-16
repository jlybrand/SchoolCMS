import { describe, expect, it } from 'vitest'

import {
  activityRow,
  approvalCards,
  approvalSummary,
  CONTENT_ACTIONS,
  freshnessRows,
  keyPageKind,
  needsAttention,
  STALE_DAYS,
  staleKeyPages,
  staleSites,
  UNCHECKED_SHOWN,
  uncheckedDocuments,
} from '@/lib/dashboard'

/**
 * The district dashboard (`04` §3.1; layout decided by Jason, 2026-11-04): approvals, what needs
 * freshening, recent activity. The pure decisions under it. The panels are custom admin React,
 * locked by `tests/e2e/district-dashboard.spec.ts` per CLAUDE.md's exception table.
 */

const TZ = 'America/New_York'
// A Wednesday, mid-afternoon in New York.
const NOW = new Date('2026-11-04T19:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

describe('approvalSummary — the queue in one line (`04` §3.1 item 1)', () => {
  it('says nothing is waiting when nothing is', () => {
    expect(approvalSummary([], NOW, TZ)).toEqual({
      count: 0,
      text: 'Nothing is waiting for approval.',
      overdue: 0,
    })
  })

  it('counts, names the oldest wait, and counts the overdue', () => {
    const summary = approvalSummary(
      [{ submittedAt: daysAgo(1) }, { submittedAt: daysAgo(7) }, { submittedAt: daysAgo(0) }],
      NOW,
      TZ,
    )
    expect(summary.count).toBe(3)
    expect(summary.overdue).toBe(1)
    expect(summary.text).toBe('3 submissions are waiting. The oldest was sent 7 days ago.')
  })

  it('reads in the singular for one', () => {
    expect(approvalSummary([{ submittedAt: daysAgo(0) }], NOW, TZ).text).toBe(
      '1 submission is waiting. It was sent today.',
    )
  })

  it('does not let an unknown send time hide a known oldest', () => {
    const summary = approvalSummary([{ submittedAt: null }, { submittedAt: daysAgo(2) }], NOW, TZ)
    expect(summary.text).toBe('2 submissions are waiting. The oldest was sent 2 days ago.')
  })
})

describe('staleSites — sites with no published change in 90 days (`04` §3.1 item 2)', () => {
  const sites = [
    { id: '1', name: 'School A' },
    { id: '2', name: 'School B' },
    { id: '3', name: 'School C' },
  ]

  it('is 90 days, from the spec', () => {
    expect(STALE_DAYS).toBe(90)
  })

  it('lists only sites past the line, longest-unchanged first', () => {
    const last = new Map([
      ['1', daysAgo(10)],
      ['2', daysAgo(200)],
      ['3', daysAgo(120)],
    ])
    expect(staleSites(sites, last, NOW, TZ)).toEqual([
      {
        id: '2',
        name: 'School B',
        at: daysAgo(200),
        last: expect.stringMatching(/^Last changed /),
      },
      {
        id: '3',
        name: 'School C',
        at: daysAgo(120),
        last: expect.stringMatching(/^Last changed /),
      },
    ])
  })

  it('lists a site with nothing published at all, first', () => {
    const last = new Map([
      ['1', daysAgo(10)],
      ['2', daysAgo(10)],
    ])
    expect(staleSites(sites, last, NOW, TZ)).toEqual([
      { id: '3', name: 'School C', at: null, last: 'Nothing published yet' },
    ])
  })

  it('treats exactly 90 days as not yet stale', () => {
    expect(staleSites([sites[0]!], new Map([['1', daysAgo(90)]]), NOW, TZ)).toEqual([])
    expect(staleSites([sites[0]!], new Map([['1', daysAgo(91)]]), NOW, TZ)).toHaveLength(1)
  })
})

describe('keyPageKind — the key page: the front page (Jason, 2026-11-04: no contact or calendar types)', () => {
  it('is the front page by its slug, at the top of the tree', () => {
    expect(keyPageKind({ slug: 'home', parent: null })).toBe('Home page')
    expect(keyPageKind({ slug: 'home', parent: 4 })).toBeNull()
  })

  it('is nothing else', () => {
    expect(keyPageKind({ slug: 'contact-us', parent: null })).toBeNull()
  })
})

describe('staleKeyPages — key pages unchanged in 90 days', () => {
  it('lists the stale ones, oldest first, with their site and kind', () => {
    const rows = staleKeyPages(
      [
        { id: 1, site: 'School A', title: 'Home', kind: 'Home page', updatedAt: daysAgo(5) },
        { id: 2, site: 'School B', title: 'Home', kind: 'Home page', updatedAt: daysAgo(100) },
        { id: 3, site: 'School C', title: 'Welcome', kind: 'Home page', updatedAt: daysAgo(300) },
      ],
      NOW,
      TZ,
    )
    expect(rows.map((r) => r.id)).toEqual([3, 2])
    expect(rows[0]).toMatchObject({
      site: 'School C',
      title: 'Welcome',
      kind: 'Home page',
      href: '/admin/collections/pages/3',
      last: expect.stringMatching(/^Last changed /),
    })
  })
})

describe('freshnessRows — the freshness panel as one table (Payload Table, 2026-11-12)', () => {
  const site = (id: string, name: string, at: string | null) => ({
    id,
    name,
    at,
    last: at ? 'Last changed …' : 'Nothing published yet',
  })
  const page = (id: number, site: string, title: string, updatedAt: string) => ({
    id,
    site,
    title,
    kind: 'Home page' as const,
    updatedAt,
    href: `/admin/collections/pages/${id}`,
    last: 'Last changed …',
  })

  it('is one list: a site with nothing published first, then oldest first, sites and pages alike', () => {
    const rows = freshnessRows(
      [site('1', 'School A', daysAgo(120)), site('2', 'School B', null)],
      [page(7, 'School C', 'Welcome', daysAgo(300)), page(8, 'School A', 'Home', daysAgo(100))],
      TZ,
    )
    expect(rows.map((r) => r.id)).toEqual(['site-2', 'page-7', 'site-1', 'page-8'])
  })

  it('says what each row is, links a page, and gives the day it last changed', () => {
    const [never, oldPage] = freshnessRows(
      [site('2', 'School B', null)],
      [page(7, 'School C', 'Welcome', '2026-03-04T15:00:00.000Z')],
      TZ,
    )
    expect(never).toEqual({
      id: 'site-2',
      site: 'School B',
      what: 'The whole site',
      href: null,
      when: 'Nothing published yet',
    })
    expect(oldPage).toEqual({
      id: 'page-7',
      site: 'School C',
      what: 'Home page: Welcome',
      href: '/admin/collections/pages/7',
      when: 'Mar 4, 2026',
    })
  })

  it('is empty when nothing is stale', () => {
    expect(freshnessRows([], [], TZ)).toEqual([])
  })
})

describe('activityRow — one line of the audit trail, content actions only', () => {
  const base = {
    contentType: 'posts',
    documentId: '9',
    documentTitle: 'Lunch menu',
    actorLabel: 'Jane Doe',
    school: 'School A',
    createdAt: daysAgo(0),
    autoApproved: false,
  }

  it('excludes sign-ins and account changes (Jason, 2026-11-04)', () => {
    expect(CONTENT_ACTIONS).not.toContain('login')
    for (const action of ['user-create', 'user-change', 'user-delete', 'grant-change']) {
      expect(CONTENT_ACTIONS).not.toContain(action)
    }
    expect(activityRow({ ...base, action: 'login' }, NOW, TZ)).toBeNull()
  })

  it('says what happened in words, and links to the item', () => {
    expect(activityRow({ ...base, action: 'submit' }, NOW, TZ)).toEqual({
      school: 'School A',
      sentence: 'Jane Doe sent the announcement “Lunch menu” for approval',
      tag: { label: 'Sent', style: 'warning' },
      href: '/admin/collections/posts/9',
      when: expect.any(String),
    })
    expect(
      activityRow({ ...base, contentType: 'pages', action: 'approve' }, NOW, TZ)?.sentence,
    ).toBe('Jane Doe approved the page “Lunch menu”')
    expect(activityRow({ ...base, action: 'request-changes' }, NOW, TZ)?.sentence).toBe(
      'Jane Doe sent the announcement “Lunch menu” back for changes',
    )
    expect(activityRow({ ...base, action: 'publish' }, NOW, TZ)?.sentence).toBe(
      'Jane Doe published the announcement “Lunch menu”',
    )
    expect(activityRow({ ...base, action: 'auto-approve' }, NOW, TZ)?.sentence).toBe(
      'The announcement “Lunch menu” by Jane Doe was published by auto-approval',
    )
    expect(activityRow({ ...base, action: 'restore' }, NOW, TZ)?.sentence).toBe(
      'Jane Doe restored an earlier version of the announcement “Lunch menu”',
    )
  })

  it('says when a post was scheduled, and when one expired (Jason, 2026-11-04)', () => {
    expect(activityRow({ ...base, action: 'schedule' }, NOW, TZ)?.sentence).toBe(
      'Jane Doe scheduled the announcement “Lunch menu” to go live later',
    )
    const expired = activityRow({ ...base, actorLabel: 'System', action: 'expire' }, NOW, TZ)
    expect(expired?.sentence).toBe(
      'The announcement “Lunch menu” expired and was taken off the website',
    )
    expect(expired?.href).toBe('/admin/collections/posts/9')
  })

  it('does not link to something deleted', () => {
    const row = activityRow({ ...base, action: 'delete' }, NOW, TZ)
    expect(row?.sentence).toBe('Jane Doe deleted the announcement “Lunch menu”')
    expect(row?.href).toBeNull()
  })

  it('tags each row with what happened, in one word and a color (Pill, 2026-11-12)', () => {
    const tag = (action: string) => activityRow({ ...base, action }, NOW, TZ)?.tag
    // Live — green.
    expect(tag('publish')).toEqual({ label: 'Published', style: 'success' })
    expect(tag('approve')).toEqual({ label: 'Approved', style: 'success' })
    expect(tag('auto-approve')).toEqual({ label: 'Auto-approved', style: 'success' })
    // Waiting on someone — amber.
    expect(tag('submit')).toEqual({ label: 'Sent', style: 'warning' })
    expect(tag('request-changes')).toEqual({ label: 'Sent back', style: 'warning' })
    // Gone — red.
    expect(tag('delete')).toEqual({ label: 'Deleted', style: 'error' })
    // The rest — neutral.
    expect(tag('schedule')).toEqual({ label: 'Scheduled', style: 'light-gray' })
    expect(tag('expire')).toEqual({ label: 'Expired', style: 'light-gray' })
    expect(tag('restore')).toEqual({ label: 'Restored', style: 'light-gray' })
  })

  it('names the district when there is no school', () => {
    expect(activityRow({ ...base, school: null, action: 'publish' }, NOW, TZ)?.school).toBe(
      'District',
    )
  })

  it('says when, briefly', () => {
    const at = (iso: string) => activityRow({ ...base, action: 'publish', createdAt: iso }, NOW, TZ)
    expect(at(new Date(NOW.getTime() - 5 * 60 * 1000).toISOString())?.when).toBe('5 min ago')
    expect(at(new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString())?.when).toBe('3 h ago')
    expect(at(daysAgo(1))?.when).toBe('Yesterday')
    expect(at(daysAgo(20))?.when).toBe('Oct 15')
  })
})

describe('needsAttention — the banners over the panels (Jason, 2026-11-12)', () => {
  it('is empty when nothing is overdue and every feed copied', () => {
    expect(needsAttention({ overdue: 0, feedFailures: [] })).toEqual([])
  })

  it('warns of overdue approvals, in the queue’s words, linking to the queue', () => {
    expect(needsAttention({ overdue: 1, feedFailures: [] })).toEqual([
      {
        type: 'warning',
        text: '1 submission is overdue. It has waited more than 3 school days.',
        href: '/admin/approvals',
      },
    ])
    expect(needsAttention({ overdue: 4, feedFailures: [] })[0]?.text).toBe(
      '4 submissions are overdue. They have waited more than 3 school days.',
    )
  })

  it('names each calendar whose feed failed, its site, and the problem, linking to it', () => {
    const items = needsAttention({
      overdue: 0,
      feedFailures: [
        {
          id: 7,
          name: 'Athletics',
          site: 'Central High',
          error: 'The address could not be reached.',
        },
      ],
    })
    expect(items).toEqual([
      {
        type: 'error',
        text: 'Central High · Athletics: the calendar feed could not be copied. The address could not be reached.',
        href: '/admin/collections/calendars/7',
      },
    ])
  })

  it('puts overdue approvals first, then feed failures by site and calendar', () => {
    const items = needsAttention({
      overdue: 2,
      feedFailures: [
        { id: 3, name: 'Sports', site: 'West Elementary', error: 'Gone.' },
        { id: 2, name: 'Testing', site: 'East Middle', error: 'Gone.' },
        { id: 1, name: 'Arts', site: 'East Middle', error: 'Gone.' },
      ],
    })
    expect(items.map((i) => i.href)).toEqual([
      '/admin/approvals',
      '/admin/collections/calendars/1',
      '/admin/collections/calendars/2',
      '/admin/collections/calendars/3',
    ])
  })

  it('says something useful when the stored problem is empty', () => {
    const [item] = needsAttention({
      overdue: 0,
      feedFailures: [{ id: 9, name: 'Arts', site: 'East Middle', error: '  ' }],
    })
    expect(item?.text).toBe(
      'East Middle · Arts: the calendar feed could not be copied. It will be tried again within the hour.',
    )
  })
})

describe('approvalCards — one card per kind, each opening the queue at that kind (2026-11-12)', () => {
  it('counts pages and announcements, each linking to its part of the queue', () => {
    expect(
      approvalCards([{ collection: 'pages' }, { collection: 'posts' }, { collection: 'pages' }]),
    ).toEqual([
      {
        id: 'approval-card-pages',
        title: '2 pages waiting',
        href: '/admin/approvals?kind=pages',
        label: 'Open the 2 pages waiting for approval',
      },
      {
        id: 'approval-card-posts',
        title: '1 announcement waiting',
        href: '/admin/approvals?kind=posts',
        label: 'Open the 1 announcement waiting for approval',
      },
    ])
  })

  it('shows both kinds even when nothing waits, so the cards do not jump about', () => {
    expect(approvalCards([]).map((c) => [c.title, c.label])).toEqual([
      ['No pages waiting', 'Open the pages part of the approval queue'],
      ['No announcements waiting', 'Open the announcements part of the approval queue'],
    ])
  })
})

/**
 * Documents not yet checked for accessibility (Jason, 2026-11-16; `07` §5): the district's
 * standing work queue. District only. Oldest first, each with its school and a link to the file,
 * where it is marked checked.
 */
describe('uncheckedDocuments — the work queue (`04` §3.1 item 5)', () => {
  const sites = new Map([
    ['3', 'School A'],
    ['4', 'School B'],
  ])
  const doc = (id: number, title: string, tenant: number, createdAt: string) => ({
    id,
    title,
    tenant,
    createdAt,
  })

  it('nothing waiting says so', () => {
    expect(uncheckedDocuments([], 0, sites, TZ)).toEqual({
      text: 'Every document has been checked for accessibility.',
      rows: [],
      more: null,
    })
  })

  it('counts, oldest first, each with its school, the file and when it was uploaded', () => {
    const panel = uncheckedDocuments(
      [doc(8, 'Bus routes', 4, daysAgo(2)), doc(5, 'Allergy plan', 3, daysAgo(30))],
      2,
      sites,
      TZ,
    )
    expect(panel.text).toBe('2 documents haven’t been checked for accessibility. Oldest first.')
    expect(panel.rows).toEqual([
      {
        id: '5',
        site: 'School A',
        title: 'Allergy plan',
        href: '/admin/collections/resources/5',
        when: 'Oct 5, 2026',
      },
      {
        id: '8',
        site: 'School B',
        title: 'Bus routes',
        href: '/admin/collections/resources/8',
        when: 'Nov 2, 2026',
      },
    ])
    expect(panel.more).toBeNull()
  })

  it('one is one', () => {
    expect(uncheckedDocuments([doc(5, 'Allergy plan', 3, daysAgo(1))], 1, sites, TZ).text).toBe(
      '1 document hasn’t been checked for accessibility. Oldest first.',
    )
  })

  it('more than it shows: a link to every one, in the Files list', () => {
    const shown = Array.from({ length: UNCHECKED_SHOWN }, (_, i) =>
      doc(i + 1, `Form ${i + 1}`, 3, daysAgo(40 - i)),
    )
    const panel = uncheckedDocuments(shown, 37, sites, TZ)
    expect(panel.rows).toHaveLength(UNCHECKED_SHOWN)
    expect(panel.text).toBe(
      `37 documents haven’t been checked for accessibility. The oldest ${UNCHECKED_SHOWN} are shown.`,
    )
    expect(panel.more).toEqual({
      text: 'See all 37',
      href: '/admin/collections/resources?where[remediationStatus][equals]=not-attested',
    })
  })

  it('a file with no title or an unknown school still shows, in words', () => {
    const [row] = uncheckedDocuments([doc(9, '  ', 99, daysAgo(3))], 1, sites, TZ).rows
    expect(row).toMatchObject({ title: 'Untitled document', site: 'Unknown site' })
  })
})
