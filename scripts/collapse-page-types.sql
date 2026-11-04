-- One-off: turn every stored page of a retired type into a plain page (Jason, 2026-11-04).
--
-- Pages had seven types; they now have two, `standard` and `composed`. About, contact, staff,
-- calendar and documents had no fields of their own, so their pages lose nothing but the label.
-- The live rows and every saved version are both converted: otherwise Postgres refuses to narrow
-- the enum when the schema is next pushed, and a restore would bring an old type back.
--
-- RUN BEFORE the first `pnpm dev` (or seed, or `payload run`) on a database that has such pages —
-- each of those starts Payload, which pushes the narrowed schema and fails on the old values:
--
--     psql -d dd2_dev -f scripts/collapse-page-types.sql
--
-- Plain SQL on purpose, for that reason. Idempotent: a second run changes nothing. A fresh
-- database (CI, a new seed) has nothing to convert.

BEGIN;
UPDATE pages SET page_type = 'standard'
  WHERE page_type::text NOT IN ('standard', 'composed');
UPDATE _pages_v SET version_page_type = 'standard'
  WHERE version_page_type::text NOT IN ('standard', 'composed');
COMMIT;
