# 11 — Integration: PowerSchool Staff Sync

Authoritative spec for pulling **staff** data from PowerSchool into the staff directory
(`people`). **No student data is pulled, ever.** One-way, read-only: PowerSchool is the
source of truth for staff facts; the CMS owns presentation and supplementary fields.

*(Carried forward from v1.0 with role and cross-reference updates. The design was sound and
survived every reconsideration of the stack.)*

## 1. Purpose & hard constraint

- **Purpose:** keep each school's staff directory current automatically, sourced from the
  district's system of record instead of hand-maintained lists. This also removes one of the
  highest-frequency manual tasks from school staff who barely have time for the website
  (`01` §2).
- **Hard constraint (non-negotiable):** the integration reads **staff/employee records
  only**. It never requests, ingests, stores, logs, or renders student records or any student
  PII. Enforced in depth (§4), tested (§9), and treated as a **release-blocking invariant**
  (`06` §7).

## 2. Integration approach

Prefer the standard, role-scoped path; fall back only if DD2's PowerSchool doesn't expose it.

| Priority | Method | Why | Staff scoping |
|---|---|---|---|
| **1 (preferred)** | **OneRoster 1.1+ API** | Standard, stable, role-typed; clean staff/teacher endpoints | Query `/users`/`/teachers` filtered to staff roles; **exclude `student` role** |
| 2 (fallback) | **PowerSchool SIS REST API** | Native, broadly available | `/staff` resources or a **staff-scoped named PowerQuery** |
| 3 (last resort) | Scheduled **staff-only export** (SFTP/CSV) | Works where APIs are locked down | Query authored to emit staff rows only |

- **Auth:** OAuth 2.0 client-credentials. **Read-only** scope, provisioned with the narrowest
  data access the district can grant — ideally a plugin scoped to staff resources so student
  data is not even reachable by the token.
- **Direction:** strictly inbound. The CMS never writes back.

## 3. Data scope — exactly what is mapped

**Allowlisted staff fields (the only fields ingested):**

| Source (staff) | `people` field | Notes |
|---|---|---|
| Given/family name | `name` | |
| Job title / role | `title` | e.g. "5th Grade Teacher", "Assistant Principal" |
| Department / subject | `department` | where available |
| Work email | `email` | district email only |
| Work phone/extension | `phone` | work only |
| School/building assignment | → tenant mapping (§5) | drives which directory they appear in |
| Staff photo *(if provided)* | `photo` (→ `media`, alt required) | optional; many districts don't expose it |
| Stable staff identifier | `powerSchoolId` | external key for upsert matching |
| Active/employment status | `active` | drives visibility on departure (§6) |

**Explicitly excluded (never requested or stored):** any student record; SSN/government IDs;
date of birth; home address; personal contact info; demographic data; compensation;
evaluation data; any student associations or class rosters. The `people` collection has **no
fields** for these, so there is nowhere for such data to land even if returned.

## 4. "No student data" — defense in depth

Five independent layers; any one failing does not breach the constraint:

1. **Credential scope:** the OAuth client is provisioned for staff resources only; student
   endpoints are not authorized to the token where PowerSchool permits this.
2. **Endpoint/query scope:** only staff/teacher endpoints or a staff-only named query are
   called. Student endpoints are never invoked.
3. **Role allowlist filter:** on ingest, every record's role/type is checked against a staff
   role allowlist; anything with a student role, or an unknown/unmapped role, is **dropped
   and counted**, never persisted.
4. **Schema constraint:** `people` has no student fields; the mapper maps only the §3
   allowlist; unmapped source fields are discarded.
5. **Assertion + test gate:** an ingest-time assertion fails the run if any record with a
   student marker reaches the persistence step; a standing test (§9) proves student records
   are never created. Logs redact PII and never contain student data.

## 5. Tenant / building mapping

- PowerSchool building IDs map to CMS `tenants` via a **building→tenant map** (config).
  `tenants.powerSchoolBuildingId` holds the link (`03` §2).
- Staff are placed in the directory of each mapped building they're assigned to; district
  office staff → district tenant.
- Multi-building staff appear in each relevant tenant's directory, or are flagged for editor
  decision per config.
- **Unmapped buildings are logged and skipped** — fail safe, no guessing.

## 6. Sync mechanics

- **Schedule:** nightly (configurable) background job in the Payload backend; manual "sync
  now" for district admins. Off the public request path entirely.
- **Upsert by `powerSchoolId`** scoped to the mapped tenant(s).
- **Field ownership (merge policy):**
  - *Source-owned (read-only in the CMS, overwritten each sync):* `name`, `title`,
    `department`, `email`, `phone`, building assignment, `active`.
  - *CMS-owned (preserved across syncs, editable):* `bio`, `visibility`, display overrides,
    and `photo` where locally set (a source photo only fills when none exists locally).
  - The admin marks source-owned fields as sync-managed and non-editable, so edits are never
    silently overwritten.
- **Departures:** a staff record absent from the feed is marked **`active: false` → hidden**
  (soft), **not hard-deleted**, so profiles don't vanish unexpectedly mid-cycle. Hard removal
  is a separate deliberate action. Grace threshold configurable.
- **Idempotency:** re-running with unchanged data is a no-op — no version churn, no spurious
  audit entries. Changes produce a clean diff and one version entry.
- **Photos:** stored to R2 with **required alt** (defaulting to the staff name), under the
  same media rules as everything else (`07` §4.3).
- **The sync bypasses the approval workflow.** It runs as a system actor writing
  source-owned fields only; there is no human submission to review (`04` §4). CMS-owned
  field edits by school staff follow the normal approval path.

## 7. Resilience & failure handling

- **Last-known-good:** a failed or partial sync **never wipes or blanks** the directory. It
  keeps existing data and alerts. Stale-but-present beats empty.
- **Partial failure:** per-record errors are collected; good records apply, bad ones are
  logged and skipped; the run reports created/updated/skipped/errored counts.
- **Directory availability is independent of PowerSchool:** the public directory renders from
  `people` via Postgres and the edge cache, so a PowerSchool outage has **zero public
  impact** (`09` §4.1).
- **Rate/backoff:** respect API limits; paginate; exponential backoff on transient errors.

## 8. Security, privacy & access

- **Secrets:** OAuth client id/secret in the platform secret store; never in the repo;
  rotated, with **expiry dates on the calendar** (`09` §7).
- **Least privilege:** read-only, staff-scoped credential.
- **FERPA posture:** by never touching student records, the integration stays entirely
  outside FERPA-protected student data. Staff directory fields are work-contact
  ("directory") information.
- **Access control:** the sync runs as a dedicated **`system-sync` actor** with rights limited
  to upserting `people` source-owned fields in mapped tenants; it cannot touch any other
  collection (`03` §6.1). Human roles cannot edit source-owned fields — those change in
  PowerSchool.
- **Auditability:** each run records actor `system`, timestamp, and per-tenant counts;
  source-owned field changes are attributable to a specific sync run (`03` §7).

## 9. Testing (mechanics in `06`; integration-specific here)

- **No-student-data invariant (must pass to release):** given a feed containing student-role
  records, assert **zero** student records are ever persisted, and only staff-role,
  allowlisted fields are mapped.
- **Mapping:** source staff fields → `people` fields correct; unmapped fields discarded.
- **Upsert/idempotency:** re-sync is a no-op; changes produce a single clean diff; new and
  removed staff handled (soft-hide on departure).
- **Tenant mapping:** building→tenant routing correct; multi-building and unmapped-building
  handling.
- **Merge policy:** CMS-owned fields (`bio`, `visibility`, local photo) survive a sync;
  source fields overwrite.
- **Access scope:** the `system-sync` actor cannot write to any collection other than
  `people`, and cannot write CMS-owned fields.
- **Resilience:** simulated API failure and partial feed keep last-known-good and alert;
  never wipe.
- **Security:** credential-scope and read-only behaviour; logs contain no PII.
- Uses a **mocked OneRoster fixture with deliberately-seeded student records**, to prove
  rejection rather than assume it.

## 10. Operations (general ops in `09`)

- **Scheduling & monitoring:** nightly job with success/failure alerting; a sync dashboard
  showing last run, counts, and errors on the district dashboard (`04` §3.1). Failures alert
  the maintainer but do not affect the site.
- **Runbook — sync failure:** confirm the public directory is still serving (it will); check
  credential expiry and PowerSchool API status; re-run manually. Last-known-good remains live
  throughout.
- **Runbook — credential rotation:** rotate in PowerSchool + secret store; verify with a
  manual sync.
- **Config:** API base URL and method, OAuth credentials (secret), building→tenant map, staff
  role allowlist, schedule, departure grace threshold.

## 11. Build placement

Built as a slice on top of the Directories module (`05`, Phase 5): schema fields + system
actor → API client → role-filter + mapper → tenant mapping → merge/upsert → scheduled job →
tests (including the no-student-data gate) → ops dashboard and alerts.

**The directory is seeded from PowerSchool at migration** rather than migrated from Finalsite
(`10` §5), so it starts authoritative and current rather than importing a stale
hand-maintained list.

## 12. Explicit non-goals

- No student data, rosters, grades, attendance, or scheduling — now or later under this
  integration.
- No write-back to PowerSchool.
- Not a general SIS integration; staff directory only.
- SSO to the district IdP is **already handled separately** via Entra ID (`02` §7) and is
  not part of this integration.
