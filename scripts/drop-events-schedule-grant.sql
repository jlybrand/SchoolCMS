-- One-off: the `events.schedule` auto-approval grant is gone (Jason, 2026-11-11). Events do not
-- go through approval at all, so the grant had nothing left to skip. This removes it from anyone
-- who holds it, then rebuilds the enum without the value — Postgres cannot drop an enum value in
-- place.
--
-- RUN BEFORE Payload next starts on a database that has the value (`pnpm dev`, seed,
-- `payload run`, `next start`): Payload pushes the schema without it, and drizzle stops at an
-- interactive prompt, which hangs.
--
--     psql -d dd2_dev -f scripts/drop-events-schedule-grant.sql
--
-- Idempotent: a second run changes nothing. A fresh database (CI, a new seed) never had it.

BEGIN;
DELETE FROM users_auto_approve WHERE value::text = 'events.schedule';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'enum_users_auto_approve' AND e.enumlabel = 'events.schedule'
  ) THEN
    ALTER TYPE enum_users_auto_approve RENAME TO enum_users_auto_approve_old;
    CREATE TYPE enum_users_auto_approve AS ENUM ('posts.routine');
    ALTER TABLE users_auto_approve
      ALTER COLUMN value TYPE enum_users_auto_approve USING value::text::enum_users_auto_approve;
    DROP TYPE enum_users_auto_approve_old;
  END IF;
END $$;
COMMIT;
