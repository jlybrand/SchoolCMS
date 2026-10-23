import { createLocalReq, type Payload } from 'payload'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { approvePage, latestVersionToken } from '@/collections/endpoints/approve-page'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * The submitter's email, inside real Payload (`04` §4.5).
 *
 * What only an integration test can show: that `previousDoc` in `afterChange` still holds the
 * submitter on an approve (the write clears it), that a request-changes save carries the note,
 * and that ordinary saves — autosaves above all — send nothing. `payload.sendEmail` is spied, so
 * nothing leaves the machine.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

afterEach(() => {
  vi.restoreAllMocks()
})

const spySend = () => vi.spyOn(payload, 'sendEmail').mockResolvedValue(undefined)

let seq = 0
const sentPage = async () => {
  seq += 1
  const page = await payload.create({
    collection: 'pages',
    data: {
      tenant: f.tenantA,
      title: `Field trip ${seq}`,
      slug: `emails-${Date.now()}-${seq}`,
      pageType: 'standard',
      visibility: 'public',
      reviewState: 'submitted',
    },
    draft: true,
    user: f.managerA,
    overrideAccess: false,
  })
  return page.id
}

describe('the submitter is emailed when the district decides', () => {
  it('approve: one email, to the manager who sent it', async () => {
    const id = await sentPage()
    const send = spySend()

    const token = await latestVersionToken(payload, id)
    expect(
      await approvePage(await createLocalReq({ user: f.districtAdmin }, payload), id, token),
    ).toEqual({
      ok: true,
    })

    expect(send).toHaveBeenCalledOnce()
    const message = send.mock.calls[0]![0] as { to: string; subject: string; text: string }
    expect(message.to).toBe(f.managerA.email)
    expect(message.subject).toMatch(/^Your page is live: Field trip \d+$/)
    expect(message.text).toContain('a.localhost')
  })

  it('request changes: one email, carrying the note', async () => {
    const id = await sentPage()
    const send = spySend()

    await payload.update({
      collection: 'pages',
      id,
      data: { reviewState: 'changes-requested', reviewNote: 'Add the permission slip.' },
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })

    expect(send).toHaveBeenCalledOnce()
    const message = send.mock.calls[0]![0] as { to: string; subject: string; text: string }
    expect(message.to).toBe(f.managerA.email)
    expect(message.subject).toMatch(/^Changes needed: /)
    expect(message.text).toContain('Add the permission slip.')
  })

  it('sending, autosaving and resending email nobody', async () => {
    const send = spySend()
    const id = await sentPage()
    await payload.update({
      collection: 'pages',
      id,
      data: { title: 'Field trip, edited' },
      draft: true,
      autosave: true,
      user: f.managerA,
      overrideAccess: false,
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('a failing email provider does not undo the approval', async () => {
    const id = await sentPage()
    vi.spyOn(payload, 'sendEmail').mockRejectedValue(new Error('provider down'))

    const token = await latestVersionToken(payload, id)
    expect(
      await approvePage(await createLocalReq({ user: f.districtAdmin }, payload), id, token),
    ).toEqual({
      ok: true,
    })
    const live = await payload.findByID({
      collection: 'pages',
      id,
      draft: false,
      overrideAccess: true,
    })
    expect(live._status).toBe('published')
  })
})
