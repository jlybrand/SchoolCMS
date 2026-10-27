# Phase 5 — Core content modules

How the content modules work mechanically, and the audit trail they write to. Phase 5 opens
with the audit trail (`05`, scheduled at the Phase 4 close); the modules — posts, events, people
and the PowerSchool sync, alerts — follow, each writing to it.

| Slice                        | State            |
| ---------------------------- | ---------------- |
| Audit trail                  | **This PR** — §1 |
| News/announcements (`posts`) | —                |
| Calendars and events         | —                |
| Directories + PowerSchool    | —                |
| Alerts                       | —                |

---

## 1. The audit trail

### Files

| File                                    | Holds                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/lib/audit.ts`                      | `auditEntries(input)` → `AuditEntry[]` (pure); `AuditAction`                                         |
| `src/collections/hooks/audit.ts`        | `auditChange(collection)` (afterChange), `auditDelete(collection)` (afterDelete), `AUDIT_COLLECTION` |
| `src/collections/AuditEvents.ts`        | `audit-events` — admin label "Activity log", GraphQL `AuditEvent` / `AuditEvents`                    |
| `tests/unit/lib/audit.test.ts`          | Which writes produce which entries                                                                   |
| `tests/integration/audit-trail.test.ts` | Real routes; append-only; district-only read; rollback when the entry cannot be written              |

Changed:

- `src/collections/Pages.ts` — `auditChange('pages')` FIRST in `afterChange`; `afterDelete: [auditDelete('pages')]`
- `src/collections/Users.ts` — `afterChange: [auditChange('users')]`, `afterDelete: [auditDelete('users')]`
- `src/payload.config.ts` — `AuditEvents` in `collections`
- `src/collections/hooks/review-state.ts` — a restore requests no review transition (below)
- `tests/integration/tenant-isolation.test.ts`, `tests/integration/graphql.test.ts`,
  `tests/e2e/admin-planes-axe.spec.ts` — cases below

### Entries

`pages` (`previous` = Payload's `previousDoc`, `doc` = the result):

| Condition, checked in order                                           | `action`          | `summary` |
| --------------------------------------------------------------------- | ----------------- | --------- |
| `operation === 'delete'`                                              | `delete`          | —         |
| `req.context.isRestoringVersion`                                      | `restore`         | —         |
| `doc._status === 'published'`, `previous.reviewState === 'submitted'` | `approve`         | —         |
| `doc._status === 'published'`, otherwise                              | `publish`         | —         |
| `previous` `submitted` → `doc` `changes-requested`                    | `request-changes` | the note  |
| `doc` `submitted`, `previous` not `submitted`                         | `submit`          | —         |
| anything else (edits, autosaves, saves on a waiting page)             | none              |           |

`users` — reads only `roles`, `tenants`, `receivesAlerts`, `email`, `name`, `autoApprove`:

| Write                                           | Entries                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| create                                          | `user-create` — `Roles: …`                                                                     |
| delete                                          | `user-delete`                                                                                  |
| roles / schools / alert setting / email changed | `user-change` — `Roles: a → b; Schools changed; Alert emails: on → off; Email address changed` |
| `autoApprove` changed                           | `grant-change` — `Auto-approval: {labels} → {labels}`                                          |
| login, password, anything else                  | none                                                                                           |

Every entry: `contentType` (the slug), `documentId`, `documentTitle` (title / name, else email,
else `Page {id}` / `User {id}`), `tenant` (pages: the page's school; users: null), `actor`
(user id, or null), `actorLabel` (the actor's email then, or `System`), `autoApproved`
(`action === 'auto-approve'`; nothing produces one yet — §13 of `docs/phases/04`).

### Writing

`payload.create({ collection: 'audit-events', data, req, overrideAccess: true })` inside the
change's transaction. A throw from it fails the change, which Payload rolls back
(`audit-trail.test.ts` "never an invisible change").

### Access

| Operation                                         | District admin | School manager | Sync | Anonymous |
| ------------------------------------------------- | -------------- | -------------- | ---- | --------- |
| read                                              | yes            | no             | no   | no        |
| create / update / delete (any API, incl. GraphQL) | no             | no             | no   | no        |

`admin.hidden` for anyone but a district admin. Not a multi-tenant plugin collection: `tenant`
is set by the hook, and user/grant rows have none.

### The restore fix

Restoring a version a school manager saved carried that version's `reviewState: 'editing'`
into the write; `applyReviewState` read it as the district requesting `editing` and refused
it. With `req.context.isRestoringVersion`, `requested` and `note` are now `undefined`, so the
page keeps its current review state. Regression: `tenant-isolation.test.ts` "a district admin
can restore a version a SCHOOL saved".

### Not here yet

- Readers of the trail: "Published" in the school's recent submissions (`docs/phases/04` §8),
  the 30-day post-hoc list of auto-approvals and the grant history (`04` §4.3), an activity
  feed on the district dashboard.
- Auto-approve entries: written when the first scope acts (Phase 5 posts).
- Sync runs (`03` §7): with the PowerSchool sync.
- New collections join by adding `auditChange(slug)` / `auditDelete(slug)` and a branch in
  `auditEntries`.
