# 11 — Integration: CSI Staff Sync

Authoritative spec for pulling **staff** data from **CSI** into the staff directory (`people`,
`staff-groups`). **No student data is pulled, ever.** One-way and read-only. CSI is the source of
truth for staff facts. The CMS owns presentation and the groups it builds on top of them.

_(Rewritten 2026-11-13. Until then this document specified a **PowerSchool** sync. Jason corrected
that on 2026-11-11: DD2's staff data comes from **CSI**, not PowerSchool. The design carried over
except where CSI differs: what it holds, how locations become groups, and the transport.
Implementation: `docs/phases/05` §38–§40.)_

## 1. Purpose & hard constraint

- **Purpose:** keep each school's staff directory current automatically, from the district's
  system of record, instead of hand-maintained lists. This removes one of the most frequent
  manual tasks from school staff who barely have time for the website (`01` §2).
- **Hard constraint (non-negotiable):** the integration reads **staff/employee records only**. It
  never requests, ingests, stores, logs, or renders student records or any student PII. CSI
  holds no student data (Jason, 2026-11-13), but the constraint is enforced in depth (§4), tested
  (§9) and treated as a **release-blocking invariant** (`06` §7) regardless.

## 2. Integration approach

- **Transport: not yet decided** (Jason, 2026-11-13: "build behind an interface, so the mapper
  takes rows regardless of transport, and decide later"). It could be a database view, a file
  drop, or an API. The sync reads through a `StaffSource`, `{ name, fetchRows() }`, which returns
  raw rows in whatever shape CSI sends. Choosing the transport adds one source; nothing
  downstream changes.
- **No CSI access yet.** Until there is, the sync runs from a **mock source**
  (`CSI_SOURCE=mock`). This stands in for the "spike, then capture a real payload" rule (CLAUDE.md
  TDD table). **The row shape is assumed** (`tests/fixtures/csi/README.md`). When a real export is
  captured, the mapper (`src/lib/csi/map.ts`) is the one place that changes.
- **Credentials**, when the transport needs them: read-only, staff-scoped, the narrowest access
  the district can grant, kept in the platform secret store (§8).
- **Direction:** strictly inbound. The CMS never writes back to CSI.

## 3. Data scope — exactly what is mapped

CSI holds little per person: a **name** (one field), an **email**, a **title** (which is the
role), and **one location** (Jason, 2026-11-13). The mapper builds a record from these fields
alone:

| CSI (assumed row field)       | Stored as                                  | Notes                                                    |
| ----------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| Employee id (`employeeId`)    | `people.csiId`                             | the match key across syncs; unique                       |
| Name (`name`, one field)      | `people.name`                              | trimmed; A–Z uses the last word (§6)                     |
| Email (`email`)               | `people.email`                             | work email, lowercased                                   |
| Title (`title`)               | `people.title`                             | **shown exactly as CSI gives it** ("Admin/teacher" stays) |
| Location (`locationId`, `locationName`) | `people.group` → that location's group | each location is a school's group (§5)                   |

There is **no** phone, department, photo or bio. CSI does not hold them, and the CMS does not ask
for them. **Explicitly excluded (never read into a record):** any student record; government
IDs; date of birth; home address; personal contact information; demographics; compensation;
evaluations; any student association. Whatever else a row carries is never read. `people` has no
fields for any of it, so there is nowhere for such data to land.

## 4. "No student data" — defense in depth

CSI holds no students, and staff and students share **one email domain**, so the domain proves
nothing. These layers apply, each independent of the others:

1. **Source scope:** a source reads staff records only.
2. **Student-marker filter** (`mapCsiRows`): a row whose title, role or type says *student* or
   *pupil*, or that has any non-empty field named like *student, grade, guardian, parent, birth,
   dob, homeroom* or *enroll*, is **dropped and counted**. The counts name no one, and no log
   carries a name or an email.
3. **Field allowlist:** a record is built from the §3 fields alone.
4. **Schema:** `people` has nowhere for student data to land.
5. **Last check before writing** (`assertStaffOnly`): independent of the mapper. If anything
   student-like reaches the write step, the whole run stops and nothing is written.

A real export whose staff rows carry a field matching a student key (for example a "grade
taught") would drop real staff. The departure guard (§7) then refuses the run rather than hiding
them. Fix the mapper when that happens.

## 5. Locations → groups

- **Each CSI location is a school's group** (`staff-groups` with a `csiLocationId`). The sync
  creates the group when it first sees the location and renames it when the location is renamed.
  Everyone at the location is in it; it has no members list of its own.
- **Sub-groups** sit inside a school's group, for example SHS › Nurses, Counselors, Teachers,
  Media Specialist. **The district** makes them, names them and ticks who is in them, from that
  school's staff, in the dashboard. They go one level deep. The sync never touches them.
- A group is a location, not a site: neither collection is tenant-scoped. A staff list on a page
  shows whichever group or sub-group it is set to (`03` §3.3).
- One location per person (Jason). Someone who moves location drops out of their old school's
  sub-groups the next time that sub-group is saved.

## 6. Sync mechanics

- **Schedule:** nightly at 02:00 on Payload's jobs queue. There is also a district-only
  `POST /api/staff-sync/run`. **There is no "Sync now" button** (Jason, 2026-11-13). It runs off
  the public request path.
- **Matching:** by CSI id.
- **Field ownership:**
  - _From CSI, read-only in the dashboard, written only by the sync:_ name, title, email,
    location (`group`), `active`, `csiId`, `syncedAt`.
  - _The dashboard's own, preserved across syncs, district only:_ a person's **Sort as** (for A–Z
    by last name when the last word is wrong, for example "de la Cruz"), the sub-groups, and who
    is in them.
  - **No staff member is created in the dashboard** (Jason): they all come from CSI.
- **Departures:** someone missing from the feed is set `active: false`, hidden from every staff
  list. They are **not deleted**. Someone back in the feed is shown again. The sync cannot delete.
- **Idempotency:** only changed fields are written. An unchanged feed writes nothing.
- **The sync bypasses the approval workflow.** It writes as `system-sync`, with the collections'
  access rules **on**, so it can touch only what those rules allow (§8). Staff data is district
  only: schools neither see nor edit it.

## 7. Resilience & failure handling

**Last-known-good:** a run that looks wrong changes **nothing**, and says why in words.

- CSI is unreachable.
- The feed is empty.
- The feed would hide **more than 5 people and more than a quarter** of the active staff.

Stale-but-present beats empty. Per-record errors are counted, and the rest of the run goes on. A
run reports created / updated / hidden / schools created and renamed / dropped (student,
incomplete, duplicate) / errors.

The public directory renders from Postgres and the edge cache, so a CSI outage has no public
impact (`09` §4.1).

## 8. Security, privacy & access

- **Secrets:** transport credentials, when there are any, live in the platform secret store,
  never in the repo. They rotate, with **expiry dates on the calendar** (`09` §7).
- **FERPA posture:** by never touching student records, the integration stays outside
  FERPA-protected student data. Staff directory fields are work-contact ("directory")
  information.
- **Access control:** the sync runs as the **`system-sync`** role (`03` §6.1). It may:
  - create and update `people` and school groups;
  - write only the fields that come from CSI;
  - never write a sort name, a sub-group or its members;
  - never delete;
  - never touch any other collection.
  
  Humans cannot edit the CSI fields; those change in CSI.
- **Logs:** CSI ids only, never a name or an email.

## 9. Testing (mechanics in `06`; integration-specific here)

- **No-student-data invariant (must pass to release):** a mock export with planted student rows
  (by title, grade, guardian, role, date of birth) creates **zero** student records and leaves no
  student detail anywhere: stored records, the run summary, the logs.
- **Mapping:** the allowlist; trimming; incomplete and duplicate rows; extra fields never read.
- **Plan:** create; no-op on unchanged; only what changed; a move; hide, no re-hide, re-show; new
  and renamed schools; an empty feed; a mass departure refused, a handful allowed.
- **Over the real stack:** the sync writes as `system-sync` with access on; the district's sort
  name and sub-groups survive a sync; a moved member drops out of the old sub-group; an
  unreachable source, an empty feed and a mass departure each change nothing; the endpoint is the
  district's alone.
- Files: `tests/fixtures/csi/`, `tests/unit/lib/csi-map.test.ts`,
  `tests/unit/lib/csi-plan.test.ts`, `tests/integration/staff-sync.test.ts`.

## 10. Operations (general ops in `09`)

- **Config:** `CSI_SOURCE` (`mock` today; unset means no sync, and the directory keeps what it
  has). Transport settings join it when the transport is chosen.
- **Monitoring:** each run logs its summary. A run history on the district dashboard is **not
  built**.
- **Runbook — sync failure:** confirm the public directory is still serving (it will be). Check
  the source's reachability and credentials, then run again (`POST /api/staff-sync/run`).
  Last-known-good stays live throughout.

## 11. Build placement

Built as Phase 5's directories slice (`05`):

- **Part A:** staff, groups and access.
- **Part B:** the sync (source interface, mapper, plan, writes, job).
- **Part C:** the staff list block.
- **Part D:** these corrections.

The directory is **seeded from CSI** at migration, not migrated from Finalsite (`10` §5).

## 12. Explicit non-goals

- No student data, rosters, grades, attendance, or scheduling, now or later.
- No write-back to CSI.
- Not a general HR or SIS integration; staff directory only.
- Staff photos, bios, phones and departments are not part of this sync. CSI does not hold them.
- SSO to the district IdP is handled separately via Entra ID (`02` §7), not here.
