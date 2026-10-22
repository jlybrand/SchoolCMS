/**
 * The queue's check on a "Request changes" note (`04` §4.4: it requires one).
 *
 * The server refuses an empty note too (`applyReviewState`). This exists because in the
 * production build that refusal's message does not reach the admin — so without it, the
 * reviewer would be told only that something was invalid.
 */

export const NOTE_REQUIRED =
  'Say what needs to change, so the school knows what to fix. The note is shown to them as written.'

export type NoteCheck = { ok: true; note: string } | { ok: false; error: string }

export const checkNote = (note: unknown): NoteCheck => {
  const trimmed = typeof note === 'string' ? note.trim() : ''
  return trimmed === '' ? { ok: false, error: NOTE_REQUIRED } : { ok: true, note: trimmed }
}
