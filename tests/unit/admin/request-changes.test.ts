import { describe, expect, it } from 'vitest'

import { checkNote, NOTE_REQUIRED } from '@/admin/Approvals/request-changes'

/**
 * "Request changes" requires a note (`04` §4.4). `applyReviewState` refuses an empty one on the
 * server; this is the queue's own check, because in the production build the server's message
 * does not reach the admin (see `docs/phases/03` §24) — the reviewer would see a bare toast.
 */

describe('checkNote', () => {
  it('accepts a note, trimmed', () => {
    expect(checkNote('  Add the return date.  ')).toEqual({
      ok: true,
      note: 'Add the return date.',
    })
  })

  it.each([
    ['empty', ''],
    ['blank', '   \n  '],
    ['missing', undefined],
    ['not text', 42],
  ])('refuses a note that is %s, saying why', (_label, note) => {
    expect(checkNote(note)).toEqual({ ok: false, error: NOTE_REQUIRED })
  })

  it('says what to do in plain words', () => {
    expect(NOTE_REQUIRED).toMatch(/school/i)
  })
})
