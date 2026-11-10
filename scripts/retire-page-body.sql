-- One-off: the CONTRACT step of "every page composed" (Jason, 2026-11-04).
--
-- Pages no longer have a `body` or a `pageType`: a page's words are Text sections. The expand
-- step (PR #69) stopped writing both and `pnpm compose:pages` moved every page's words into a Text
-- section. This drops what is left: the two columns on `pages`, the two on its versions, their
-- indexes and their enum types.
--
-- WHAT IS LOST: the words of page VERSIONS saved before PR #69, which only ever lived in
-- `_pages_v.version_body`. Restoring one of those old versions brings back its title, settings
-- and sections, not those words. Pre-production, with no real content, that was judged not
-- worth converting history for (`docs/phases/05-content-modules.md` §24).
--
-- RUN BEFORE Payload next starts on a database that still has these columns (`pnpm dev`, seed,
-- `payload run`, `next start`): Payload pushes the schema without them, and drizzle stops at an
-- interactive data-loss prompt, which hangs.
--
--     psql -d dd2_dev -f scripts/retire-page-body.sql
--
-- Idempotent: a second run changes nothing. A fresh database (CI, a new seed) never had them.

BEGIN;
DROP INDEX IF EXISTS pages_page_type_idx;
DROP INDEX IF EXISTS _pages_v_version_version_page_type_idx;
ALTER TABLE pages DROP COLUMN IF EXISTS body, DROP COLUMN IF EXISTS page_type;
ALTER TABLE _pages_v DROP COLUMN IF EXISTS version_body, DROP COLUMN IF EXISTS version_page_type;
DROP TYPE IF EXISTS enum_pages_page_type;
DROP TYPE IF EXISTS enum__pages_v_version_page_type;
COMMIT;
