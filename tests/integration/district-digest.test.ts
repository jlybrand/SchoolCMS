import { createLocalReq, type Payload } from 'payload'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { runDistrictDigest } from '@/jobs/district-digest'

import { getTestPayload, SEED_PASSWORD, seed, type Fixtures } from '../helpers/payload'

/**
 * The district's digest and overdue alert, inside real Payload (`04` §4.5, §5).
 *
 * What only an integration test can show: that the task reads the queue as it really is (the
 * submitted state lives on the latest VERSION, not the page row), that every district admin —
 * and nobody else — is mailed, and that the task is wired into Payload's jobs queue.
 * `payload.sendEmail` is spied, so nothing leaves the machine.
 *
 * Times are fixed far in the future so the pages sent "now" are long overdue but not newly so:
 * the rules for WHEN each email goes are `tests/unit/lib/district-digest.test.ts`.
 */

// Tuesday 8 January 2030, 7:00 and 9:00 in New York (EST).
const DIGEST_HOUR = new Date('2030-01-08T12:00:00Z')
const LATER = new Date('2030-01-08T14:00:00Z')
/**
 * Tuesday 6 January 2026, 7:00 EST — in the PAST, because Payload runs a queued job only once
 * its `waitUntil` has passed. A scheduled run's `waitUntil` is the hour it was scheduled for,
 * and that is the time the task decides by.
 */
const PAST_DIGEST_HOUR = new Date('2026-01-06T12:00:00Z')

let payload: Payload
let f: Fixtures
let secondAdmin: string

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
  // `04` §5: a second district admin with equal rights. The digest must reach both.
  secondAdmin = 'second-admin@test.local'
  await payload.create({
    collection: 'users',
    data: {
      email: secondAdmin,
      password: SEED_PASSWORD,
      name: 'Second admin',
      roles: ['district-admin'],
    },
    overrideAccess: true,
  })
}, 120_000)

afterEach(() => {
  vi.restoreAllMocks()
})

const spySend = () => vi.spyOn(payload, 'sendEmail').mockResolvedValue(undefined)

const sendPage = async (title: string) => {
  await payload.create({
    collection: 'pages',
    data: {
      tenant: f.tenantA,
      title,
      slug: `digest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      visibility: 'public',
      reviewState: 'submitted',
    },
    draft: true,
    user: f.managerA,
    overrideAccess: false,
  })
}

const req = () => createLocalReq({}, payload)

describe('the district digest', () => {
  it('at the digest hour: every district admin gets one digest listing what waits', async () => {
    await sendPage('Picture day')
    const send = spySend()

    await runDistrictDigest(await req(), DIGEST_HOUR)

    const to = send.mock.calls.map(([message]) => message.to).sort()
    expect(to).toEqual(['district-admin@test.local', secondAdmin].sort())
    const [message] = send.mock.calls[0]!
    expect(message.subject).toMatch(/waiting for approval/)
    expect(message.text).toContain('Picture day — School A')
    expect(message.text).toContain('/admin/approvals')
  })

  it('an announcement waiting is in the same digest, named as one', async () => {
    await payload.create({
      collection: 'posts',
      data: {
        tenant: f.tenantA,
        board: f.boardA,
        title: 'Book fair',
        slug: `digest-post-${Date.now()}`,
        visibility: 'public',
        body: {
          root: {
            type: 'root',
            children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Friday.' }] }],
          },
        } as never,
        reviewState: 'submitted',
      },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    const send = spySend()

    await runDistrictDigest(await req(), DIGEST_HOUR)

    const [message] = send.mock.calls[0]!
    expect(message.text).toContain('Book fair (announcement) — School A')
  })

  it('school managers are never mailed the district digest', async () => {
    await sendPage('Lunch menu')
    const send = spySend()

    await runDistrictDigest(await req(), DIGEST_HOUR)

    const to = send.mock.calls.map(([message]) => message.to)
    expect(to).not.toContain(f.managerA.email)
    expect(to).not.toContain(f.managerB.email)
    expect(to).not.toContain(f.noTenantManager.email)
  })

  it('outside the digest hour: nothing is sent', async () => {
    await sendPage('Book fair')
    const send = spySend()

    await runDistrictDigest(await req(), LATER)

    expect(send).not.toHaveBeenCalled()
  })

  it('one admin whose address fails does not stop the other getting it', async () => {
    await sendPage('Spirit week')
    const send = vi.spyOn(payload, 'sendEmail').mockImplementation(async (message) => {
      if ((message as { to: string }).to === secondAdmin) throw new Error('provider says no')
      return undefined
    })

    await expect(runDistrictDigest(await req(), DIGEST_HOUR)).resolves.not.toThrow()
    expect(send.mock.calls.map(([m]) => m.to)).toContain('district-admin@test.local')
  })

  it('runs as a task on Payload’s jobs queue', async () => {
    await sendPage('Concert')
    const send = spySend()

    await payload.jobs.queue({ task: 'districtDigest', input: {}, waitUntil: PAST_DIGEST_HOUR })
    await payload.jobs.run({ queue: 'default' })

    expect(send.mock.calls.map(([m]) => m.to)).toContain('district-admin@test.local')
  })
})

describe('who gets the district’s mail (`users.receivesAlerts`)', () => {
  const setAlerts = async (email: string, receivesAlerts: boolean) => {
    const { docs } = await payload.find({
      collection: 'users',
      where: { email: { equals: email } },
      overrideAccess: true,
    })
    await payload.update({
      collection: 'users',
      id: docs[0]!.id,
      data: { receivesAlerts },
      overrideAccess: true,
    })
  }

  afterEach(async () => {
    await setAlerts('district-admin@test.local', true)
    await setAlerts(secondAdmin, true)
  })

  it('every district admin is opted in by default', async () => {
    const { docs } = await payload.find({
      collection: 'users',
      where: { roles: { in: ['district-admin'] } },
      overrideAccess: true,
    })
    expect(docs.map((u) => u.receivesAlerts)).toEqual(docs.map(() => true))
  })

  it('an admin who opted out is not mailed; the other still is', async () => {
    await sendPage('Fun run')
    await setAlerts(secondAdmin, false)
    const send = spySend()

    await runDistrictDigest(await req(), DIGEST_HOUR)

    expect(send.mock.calls.map(([m]) => m.to)).toEqual(['district-admin@test.local'])
  })

  it('if every admin opted out, every admin is mailed and it is logged', async () => {
    await sendPage('Science fair')
    await setAlerts('district-admin@test.local', false)
    await setAlerts(secondAdmin, false)
    const send = spySend()
    const warn = vi.spyOn(payload.logger, 'warn')

    await runDistrictDigest(await req(), DIGEST_HOUR)

    expect(send.mock.calls.map(([m]) => m.to).sort()).toEqual(
      ['district-admin@test.local', secondAdmin].sort(),
    )
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/nobody is opted in/i))
  })
})
