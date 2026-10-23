import { describe, expect, it, vi } from 'vitest'

import { makeNotifyReviewOutcome } from '@/collections/hooks/notify-review-outcome'

/**
 * The hook that emails the submitter when the district decides (`04` §4.5).
 *
 * Its collaborators are injected so this can assert exactly what is sent, to whom, and that a
 * failure to send never fails the approval itself. `tests/integration/review-emails.test.ts`
 * runs it inside real Payload.
 */

const setup = () => {
  const send = vi.fn().mockResolvedValue(undefined)
  const logError = vi.fn()
  const hook = makeNotifyReviewOutcome({
    send,
    serverUrl: 'http://localhost:3000',
    recipientFor: async (userId) => (String(userId) === '7' ? 'manager@school.example' : null),
    schoolFor: async () => ({ name: 'School A', hostname: 'a.localhost' }),
    pathFor: async () => '/bus-routes',
  })
  const req = { payload: { logger: { error: logError } } }
  const run = (previousDoc: Record<string, unknown> | undefined, doc: Record<string, unknown>) =>
    hook({ previousDoc, doc, req, operation: 'update' } as never)
  return { send, logError, run }
}

const waiting = { id: 12, title: 'Bus routes', tenant: 2, reviewState: 'submitted', submittedBy: 7 }

describe('notifyReviewOutcome', () => {
  it('on approval, emails the person who sent it, with a link to the live page', async () => {
    const { send, run } = setup()
    const doc = { ...waiting, reviewState: null, submittedBy: null, _status: 'published' }
    await expect(run(waiting, doc)).resolves.toBe(doc)

    expect(send).toHaveBeenCalledOnce()
    const message = send.mock.calls[0]![0]
    expect(message.to).toBe('manager@school.example')
    expect(message.subject).toBe('Your page is live: Bus routes')
    expect(message.text).toContain('http://a.localhost:3000/bus-routes')
  })

  it('reads the submitter from BEFORE the write — approval clears it', async () => {
    const { send, run } = setup()
    await run(waiting, { ...waiting, reviewState: null, submittedBy: null, _status: 'published' })
    expect(send.mock.calls[0]![0].to).toBe('manager@school.example')
  })

  it('on a send-back, emails the note and a link to the page form', async () => {
    const { send, run } = setup()
    await run(waiting, {
      ...waiting,
      reviewState: 'changes-requested',
      reviewNote: 'Please add the return times.',
    })
    const message = send.mock.calls[0]![0]
    expect(message.subject).toBe('Changes needed: Bus routes')
    expect(message.text).toContain('Please add the return times.')
    expect(message.text).toContain('http://localhost:3000/admin/collections/pages/12')
  })

  it('a write that is not an outcome sends nothing', async () => {
    const { send, run } = setup()
    await run(waiting, { ...waiting, title: 'Bus routes (typo fixed)' })
    await run({ ...waiting, reviewState: 'editing' }, waiting)
    expect(send).not.toHaveBeenCalled()
  })

  it('a submitter with no email address is logged, not guessed at', async () => {
    const { send, logError, run } = setup()
    const before = { ...waiting, submittedBy: 99 }
    await run(before, { ...before, reviewState: 'changes-requested', reviewNote: 'x' })
    expect(send).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledOnce()
  })

  it('a failed send never fails the approval — it logs', async () => {
    const { send, logError, run } = setup()
    send.mockRejectedValue(new Error('Resend is down'))
    const doc = { ...waiting, reviewState: null, submittedBy: null, _status: 'published' }
    await expect(run(waiting, doc)).resolves.toBe(doc)
    expect(logError).toHaveBeenCalledOnce()
  })

  it('reads a populated submitter', async () => {
    const { send, run } = setup()
    const before = { ...waiting, submittedBy: { id: 7, email: 'ignored@x' } }
    await run(before, { ...before, reviewState: 'changes-requested', reviewNote: 'x' })
    expect(send.mock.calls[0]![0].to).toBe('manager@school.example')
  })
})
