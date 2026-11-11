-- One-off: events skip approval (Jason, 2026-11-11), so they lose the review fields PR #73 gave
-- them — `reviewState`, `reviewNote`, `submittedAt`, `submittedBy` — on the events and on their
-- versions, with their indexes and enum types. Nothing was ever sent for approval: the school task
-- that would have sent events was never merged.
--
-- RUN BEFORE Payload next starts on a database that has them (`pnpm dev`, seed, `payload run`,
-- `next start`): Payload pushes the schema without them, and drizzle stops at an interactive
-- data-loss prompt, which hangs.
--
--     psql -d dd2_dev -f scripts/drop-event-review-fields.sql
--
-- Idempotent: a second run changes nothing. A fresh database (CI, a new seed) never had them.

BEGIN;
DROP INDEX IF EXISTS events_review_state_idx;
DROP INDEX IF EXISTS events_submitted_at_idx;
DROP INDEX IF EXISTS events_submitted_by_idx;
DROP INDEX IF EXISTS _events_v_version_version_review_state_idx;
DROP INDEX IF EXISTS _events_v_version_version_submitted_at_idx;
DROP INDEX IF EXISTS _events_v_version_version_submitted_by_idx;
ALTER TABLE IF EXISTS events
  DROP COLUMN IF EXISTS review_state,
  DROP COLUMN IF EXISTS review_note,
  DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS submitted_by_id;
ALTER TABLE IF EXISTS _events_v
  DROP COLUMN IF EXISTS version_review_state,
  DROP COLUMN IF EXISTS version_review_note,
  DROP COLUMN IF EXISTS version_submitted_at,
  DROP COLUMN IF EXISTS version_submitted_by_id;
DROP TYPE IF EXISTS enum_events_review_state;
DROP TYPE IF EXISTS enum__events_v_version_review_state;
COMMIT;
