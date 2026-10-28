import { describe, expect, it } from 'vitest'

import {
  alertRecipients,
  DIGEST_HOUR,
  digestEmail,
  districtMail,
  isDigestTime,
  newlyOverdue,
  overdueAlertEmail,
  type WaitingPage,
} from '@/lib/district-digest'

/**
 * The district's mail about the queue (`04` §4.5, §5): a daily digest of what is waiting, and an
 * alert when something passes the overdue threshold — to every district admin, because a single
 * approver is a single point of failure for 28 schools.
 *
 * Pure: when the morning run happens, which pages count as NEWLY overdue, what the emails say.
 * The scheduled task that reads the queue and sends is `src/jobs/district-digest.ts`.
 *
 * Dates are October–November 2026 in America/New_York; US daylight saving ends 1 November, so
 * 7am is 11:00Z before it and 12:00Z after.
 */

const TZ = 'America/New_York'
const QUEUE = 'https://admin.example/admin/approvals'

const page = (title: string, sentAt: string, school = 'Adams Elementary'): WaitingPage => ({
  title,
  school,
  sentAt,
})

describe('isDigestTime — weekday mornings at the digest hour, district time', () => {
  it('the digest hour is 7am', () => {
    expect(DIGEST_HOUR).toBe(7)
  })

  it.each([
    ['Mon 7:00 EDT', '2026-10-26T11:00:00Z', true],
    ['Mon 7:59 EDT', '2026-10-26T11:59:00Z', true],
    ['Fri 7:05 EDT', '2026-10-23T11:05:00Z', true],
    ['Mon 7:00 EST, after daylight saving ends', '2026-11-02T12:00:00Z', true],
    ['Mon 6:59 EDT', '2026-10-26T10:59:00Z', false],
    ['Mon 8:00 EDT', '2026-10-26T12:00:00Z', false],
    ['Mon 6:00 EST — 11:00Z is no longer 7am', '2026-11-02T11:00:00Z', false],
    ['Sat 7:00 EDT', '2026-10-24T11:00:00Z', false],
    ['Sun 7:00 EDT', '2026-10-25T11:00:00Z', false],
  ])('%s → %s', (_label, at, expected) => {
    expect(isDigestTime(new Date(at), TZ)).toBe(expected)
  })
})

describe('newlyOverdue — overdue this morning, not yesterday morning', () => {
  // Overdue = more than 3 school days (`src/lib/queue-age.ts`). Sent Wednesday 21 October:
  // Thu, Fri, Mon count 3; Tuesday 27 makes 4.
  const wednesday = page('Picture day', '2026-10-21T14:00:00Z')

  it('the morning a page crosses the threshold, it is newly overdue', () => {
    expect(newlyOverdue([wednesday], new Date('2026-10-27T11:00:00Z'), TZ)).toEqual([wednesday])
  })

  it('the day before, it is not overdue at all', () => {
    expect(newlyOverdue([wednesday], new Date('2026-10-26T11:00:00Z'), TZ)).toEqual([])
  })

  it('the day after, it is still overdue but no longer NEW — the alert is not repeated', () => {
    expect(newlyOverdue([wednesday], new Date('2026-10-28T11:00:00Z'), TZ)).toEqual([])
  })

  it('across a weekend: a page that crosses on Monday is new on Monday', () => {
    // Sent Tuesday 20: Wed, Thu, Fri count 3; the weekend adds none; Monday 26 makes 4.
    const tuesday = page('Book fair', '2026-10-20T14:00:00Z')
    expect(newlyOverdue([tuesday], new Date('2026-10-26T11:00:00Z'), TZ)).toEqual([tuesday])
  })

  it('a page with no usable send time is never overdue', () => {
    expect(newlyOverdue([page('Odd', 'not a date')], new Date('2026-10-27T11:00:00Z'), TZ)).toEqual(
      [],
    )
  })
})

describe('digestEmail', () => {
  const now = new Date('2026-10-27T11:00:00Z') // Tue 7am

  it('nothing waiting → no email; an empty digest is the noise `04` §4.5 warns about', () => {
    expect(digestEmail({ pages: [], now, timeZone: TZ, queueUrl: QUEUE })).toBeNull()
  })

  it('lists each waiting page with its school and how long it has waited', () => {
    const email = digestEmail({
      pages: [
        page('Picture day', '2026-10-21T14:00:00Z'),
        page('Lunch menu', '2026-10-26T14:00:00Z', 'Lincoln Middle'),
      ],
      now,
      timeZone: TZ,
      queueUrl: QUEUE,
    })
    expect(email?.subject).toBe('2 submissions waiting for approval (1 overdue)')
    expect(email?.text).toContain('Picture day — Adams Elementary — Sent 6 days ago (overdue)')
    expect(email?.text).toContain('Lunch menu — Lincoln Middle — Sent yesterday')
    expect(email?.text).not.toContain('Lunch menu — Lincoln Middle — Sent yesterday (overdue)')
    expect(email?.text).toContain(QUEUE)
    expect(email?.html).toContain(`href="${QUEUE}"`)
  })

  it('one page, none overdue: singular, and no overdue count', () => {
    const email = digestEmail({
      pages: [page('Lunch menu', '2026-10-26T14:00:00Z')],
      now,
      timeZone: TZ,
      queueUrl: QUEUE,
    })
    expect(email?.subject).toBe('1 submission waiting for approval')
  })

  it('escapes what schools typed, and keeps the subject to one line', () => {
    const email = digestEmail({
      pages: [page('<b>Hi</b>\nBcc: x@example.com', '2026-10-26T14:00:00Z', 'A & B')],
      now,
      timeZone: TZ,
      queueUrl: QUEUE,
    })
    expect(email?.html).toContain('&lt;b&gt;Hi&lt;/b&gt; Bcc: x@example.com')
    expect(email?.html).toContain('A &amp; B')
    expect(email?.html).not.toContain('<b>Hi</b>')
    expect(email?.text).not.toMatch(/\nBcc:/)
  })

  it('names an announcement as one, beside its title', () => {
    const email = digestEmail({
      pages: [{ ...page('Picture day', '2026-10-26T14:00:00Z'), kind: 'announcement' }],
      now,
      timeZone: TZ,
      queueUrl: QUEUE,
    })
    expect(email?.text).toContain('Picture day (announcement) — Adams Elementary — Sent yesterday')
  })

  it('says "submission", never "draft", "collection" or "tenant"', () => {
    const email = digestEmail({
      pages: [page('Lunch menu', '2026-10-26T14:00:00Z')],
      now,
      timeZone: TZ,
      queueUrl: QUEUE,
    })
    expect(`${email?.subject} ${email?.text}`).not.toMatch(/draft|collection|tenant/i)
  })
})

describe('overdueAlertEmail', () => {
  const now = new Date('2026-10-27T11:00:00Z')

  it('nothing newly overdue → no alert', () => {
    expect(overdueAlertEmail({ pages: [], now, timeZone: TZ, queueUrl: QUEUE })).toBeNull()
  })

  it('names the overdue pages and the threshold, and links to the queue', () => {
    const email = overdueAlertEmail({
      pages: [page('Picture day', '2026-10-21T14:00:00Z')],
      now,
      timeZone: TZ,
      queueUrl: QUEUE,
    })
    expect(email?.subject).toBe('Overdue: 1 submission waiting more than 3 school days')
    expect(email?.text).toContain('Picture day — Adams Elementary — Sent 6 days ago')
    expect(email?.text).toContain(QUEUE)
  })

  it('plural', () => {
    const email = overdueAlertEmail({
      pages: [page('A', '2026-10-21T14:00:00Z'), page('B', '2026-10-21T15:00:00Z')],
      now,
      timeZone: TZ,
      queueUrl: QUEUE,
    })
    expect(email?.subject).toBe('Overdue: 2 submissions waiting more than 3 school days')
  })
})

describe('districtMail — what one hourly run sends', () => {
  const crossing = page('Picture day', '2026-10-21T14:00:00Z') // newly overdue Tue 27
  const fresh = page('Lunch menu', '2026-10-26T14:00:00Z')

  it('outside the digest hour: nothing, whatever is waiting', () => {
    expect(
      districtMail({
        pages: [crossing, fresh],
        at: new Date('2026-10-27T15:00:00Z'),
        timeZone: TZ,
        queueUrl: QUEUE,
      }),
    ).toEqual([])
  })

  it('at the digest hour with a page crossing the threshold: the digest AND the alert', () => {
    const mail = districtMail({
      pages: [crossing, fresh],
      at: new Date('2026-10-27T11:00:00Z'),
      timeZone: TZ,
      queueUrl: QUEUE,
    })
    expect(mail.map((m) => m.subject)).toEqual([
      '2 submissions waiting for approval (1 overdue)',
      'Overdue: 1 submission waiting more than 3 school days',
    ])
  })

  it('a page still overdue the next day is in the digest but raises no second alert', () => {
    const mail = districtMail({
      pages: [crossing],
      at: new Date('2026-10-28T11:00:00Z'),
      timeZone: TZ,
      queueUrl: QUEUE,
    })
    expect(mail.map((m) => m.subject)).toEqual(['1 submission waiting for approval (1 overdue)'])
  })

  it('an empty queue at the digest hour: nothing', () => {
    expect(
      districtMail({
        pages: [],
        at: new Date('2026-10-27T11:00:00Z'),
        timeZone: TZ,
        queueUrl: QUEUE,
      }),
    ).toEqual([])
  })
})

/**
 * Who gets the district's mail (Jason, 2026-10-23): district admins choose which of them are
 * mailed. Rights stay equal — this is about mail, never permission. The queue must never go
 * silent, so if nobody is opted in, every admin is mailed.
 */
describe('alertRecipients', () => {
  const admin = (email: unknown, receivesAlerts?: unknown) => ({ email, receivesAlerts })

  it('mails the admins who are opted in, and not the ones who opted out', () => {
    expect(
      alertRecipients([
        admin('a@dd2.org', true),
        admin('b@dd2.org', false),
        admin('c@dd2.org', true),
      ]),
    ).toEqual({ to: ['a@dd2.org', 'c@dd2.org'], fallback: false })
  })

  it('an admin with no setting stored is opted in — today’s behaviour is the default', () => {
    expect(alertRecipients([admin('a@dd2.org'), admin('b@dd2.org', null)])).toEqual({
      to: ['a@dd2.org', 'b@dd2.org'],
      fallback: false,
    })
  })

  it('if every admin opted out, every admin is mailed and the fallback is reported', () => {
    expect(alertRecipients([admin('a@dd2.org', false), admin('b@dd2.org', false)])).toEqual({
      to: ['a@dd2.org', 'b@dd2.org'],
      fallback: true,
    })
  })

  it('skips admins with no usable address, and lists each address once', () => {
    expect(
      alertRecipients([admin(''), admin(null), admin(' a@dd2.org '), admin('a@dd2.org')]),
    ).toEqual({ to: ['a@dd2.org'], fallback: false })
  })

  it('no admins at all: nobody to mail', () => {
    expect(alertRecipients([])).toEqual({ to: [], fallback: false })
  })
})
