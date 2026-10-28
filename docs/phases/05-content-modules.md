# Phase 5 — Core content modules

How the content modules work mechanically, and the audit trail they write to. Phase 5 opens
with the audit trail (`05`, scheduled at the Phase 4 close); the modules — posts, events, people
and the PowerSchool sync, alerts — follow, each writing to it.

| Slice                        | State                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Audit trail                  | Merged (#42) — §1                                                                                  |
| News/announcements (`posts`) | **This PR** — §2: collection, access, syndication read; queue, school task, feed and template next |
| Calendars and events         | —                                                                                                  |
| Directories + PowerSchool    | —                                                                                                  |
| Alerts                       | —                                                                                                  |

---

## 1. The audit trail

### Files

| File                                    | Holds                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/audit.ts`                      | `auditEntries(input)` → `AuditEntry[]` (pure); `AuditAction`                                                                    |
| `src/collections/hooks/audit.ts`        | `auditChange(collection)` (afterChange), `auditDelete(collection)` (afterDelete), `auditLogin` (afterLogin), `AUDIT_COLLECTION` |
| `src/collections/AuditEvents.ts`        | `audit-events` — admin label "Activity log", GraphQL `AuditEvent` / `AuditEvents`                                               |
| `tests/unit/lib/audit.test.ts`          | Which writes produce which entries                                                                                              |
| `tests/integration/audit-trail.test.ts` | Real routes; append-only; district-only read; rollback when the entry cannot be written                                         |

Changed:

- `src/collections/Pages.ts` — `auditChange('pages')` FIRST in `afterChange`; `afterDelete: [auditDelete('pages')]`
- `src/collections/Users.ts` — `afterChange: [auditChange('users')]`, `afterDelete: [auditDelete('users')]`, `afterLogin: [auditLogin]`
- `src/collections/hooks/page-history.ts` — only a published version can be restored; sets `req.context.restoreAsDraft`
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
| successful sign-in (`afterLogin`)               | `login` — actor is the person signing in                                                       |
| failed sign-in, password change, anything else  | none                                                                                           |

Every entry: `contentType` (the slug), `documentId`, `documentTitle` (title / name, else email,
else `Page {id}` / `User {id}`), `tenant` (pages: the page's school; users: null), `actor`
(user id, or null), `actorLabel` (the actor's email then, or `System`), `autoApproved`
(`action === 'auto-approve'`; nothing produces one yet — §13 of `docs/phases/04`).

### Writing

`payload.create({ collection: 'audit-events', data, req, overrideAccess: true })` inside the
change's transaction.

Before writing, each `actor` is checked against `users` (`findByID`, access overridden). If no
row matches — the seed's synthetic `{ id: 0 }` request identity, or a user deleting their own
account — `actor` is null and `actorLabel` keeps the identity's email, or `System` when it has
none. A throw from it fails the change, which Payload rolls back
(`audit-trail.test.ts` "never an invisible change").

### Access

| Operation                                         | District admin | School manager | Sync | Anonymous |
| ------------------------------------------------- | -------------- | -------------- | ---- | --------- |
| read                                              | yes            | no             | no   | no        |
| create / update / delete (any API, incl. GraphQL) | no             | no             | no   | no        |

`admin.hidden` for anyone but a district admin. Not a multi-tenant plugin collection: `tenant`
is set by the hook, and user/grant rows have none.

### Restoring: only a published version (Jason, 2026-10-27)

`restoreIsDistrictOnly` (`beforeOperation`, `restoreVersion`) also reads the version
(`findVersionByID`, access overridden) and refuses unless `version._status === 'published'`:
`APIError('Only a version that was published can be restored.', 403)`. Applies to district
admins; school managers are refused before it. `overrideAccess` passes.

It also sets `req.context.restoreAsDraft = args.draft === true`. Payload sets a restore's status
from `draft` only after the hooks run, so `applyReviewState` would otherwise read the restored
version's own `published` as a publish and clear the review state on a draft restore.

**Payload 3.87's Local API `restoreVersion` drops `draft`**, so every Local API restore
publishes. A restore as a draft is REST (`POST /api/pages/versions/:id?draft=true`) or the
admin's option; `tests/e2e/page-history.spec.ts` covers it.

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

---

## 2. News and announcements (`posts`) — the collection

### Files

| File                                  | Holds                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/collections/Posts.ts`            | `posts` — admin "News and announcements" / "Announcement", GraphQL `Post` / `Posts`                                                   |
| `src/access/posts.ts`                 | `postsReadAccess`, `postsCreateAccess`, `postsUpdateAccess`, `postsDeleteAccess`, `postsReadVersionsAccess`, `PUBLIC_POST_CONSTRAINT` |
| `src/collections/hooks/post-hooks.ts` | `uniquePostSlug` (beforeValidate), `stampPublishedDate` + `stampPublishedDateHook` (beforeChange)                                     |
| `src/content/syndication.ts`          | `syndicationConstraint(tenantId)` → `Where`; `SYNDICATION_SCOPES`                                                                     |
| `src/content/post-mapper.ts`          | `toPost(row)` → `Post \| null` (pure)                                                                                                 |
| `src/content/posts.ts`                | `listPosts(ctx, { limit })` → `Post[]`                                                                                                |
| `src/content/types.ts`                | `Post`                                                                                                                                |
| `tests/e2e/support/fixture-posts.ts`  | `makePost`, `dropPost`                                                                                                                |

Changed:

- `src/lib/audit.ts` — `posts` recorded as pages are (`REVIEWED` map; untitled → `Post {id}`)
- `src/lib/slug.ts` — `nextFreeSlug(base, taken)`
- `src/collections/hooks/page-history.ts` — reads the version from the collection the hook runs on
- `src/payload.config.ts` — `Posts` in `collections`; `posts: {}` in the multi-tenant plugin
- `tests/helpers/payload.ts` — `seed` deletes posts and returns `districtTenant`; `seedPosts(payload, f)`

### Fields

| Field                                                     | Type                                               | Who writes it                         |
| --------------------------------------------------------- | -------------------------------------------------- | ------------------------------------- |
| `tenant`                                                  | injected by the multi-tenant plugin                |                                       |
| `title`, `body` (required)                                | text, rich text (global editor)                    | anyone with update access             |
| `slug`                                                    | text, derived from the title                       | hooks; then anyone with update access |
| `excerpt` ("Summary")                                     | textarea, ≤ 300                                    | anyone with update access             |
| `visibility`                                              | radio `public` / `staff`                           | anyone with update access             |
| `publishedDate`                                           | date                                               | district only (field access); stamped |
| `syndication.scope`                                       | radio `this-tenant` / `district-wide` / `selected` | district only — read too              |
| `syndication.syndicatedTo`                                | relationship → tenants, hasMany, not sortable      | district only — read too              |
| `reviewState`, `reviewNote`, `submittedAt`, `submittedBy` | as pages                                           | `applyReviewState`                    |
| `requiresTranslationReview`                               | checkbox                                           | district only                         |

Versions: drafts, autosave, `validate: true`, 50 per document — as pages.

### Hooks, in order

| Stage           | Hooks                                                       |
| --------------- | ----------------------------------------------------------- |
| beforeOperation | `restoreIsDistrictOnly`                                     |
| beforeValidate  | `deriveSlugFromTitle`, `uniquePostSlug`                     |
| beforeChange    | `publishGate`, `stampPublishedDateHook`, `applyReviewState` |
| afterChange     | `auditChange('posts')`                                      |
| afterDelete     | `auditDelete('posts')`                                      |

`uniquePostSlug`: finds the tenant's posts whose slug is `like` the slug (access overridden).
On create, takes `nextFreeSlug` — `picture-day`, `picture-day-2`, … the lowest free. On update,
a slug another post in the school holds is a `ValidationError` on `slug`.

`stampPublishedDate`: a write with `_status: 'published'` and no `publishedDate` on the write or
the stored document gets now. Display only — nothing filters on it.

### Access

| Operation    | District admin | School manager                       | Sync | Anonymous                |
| ------------ | -------------- | ------------------------------------ | ---- | ------------------------ |
| read         | all            | `{ tenant: { in: their schools } }`  | no   | `PUBLIC_POST_CONSTRAINT` |
| create       | yes            | own school; not `_status: published` | no   | no                       |
| update       | yes            | constraint; not `_status: published` | no   | no                       |
| delete       | yes            | no                                   | no   | no                       |
| readVersions | yes            | no                                   | no   | no                       |

Syndication grants nothing through the API: a school manager does not read the district's
posts, shared or not. A syndication value a school manager sends is dropped by field access.

### Syndication — the one cross-tenant read (`03` §6.4 invariant 3)

`listPosts(ctx)` queries `posts` with access overridden:

```
and: [ syndicationConstraint(ctx.tenant.id), _status = published, visibility = public ]
syndicationConstraint(T) = or: [ tenant = T,
                                 syndication.scope = district-wide,
                                 and: [ syndication.scope = selected, syndication.syndicatedTo in [T] ] ]
```

sorted `-publishedDate, -id`, limit clamped to 1–100, rows through `toPost` (unusable rows
dropped). A post switched back to `this-tenant` keeps its `syndicatedTo` list in the row; only
`selected` reads it.

### Tests

| File                                         | Covers                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/access/posts.test.ts`            | every access function, per role                                                                                       |
| `tests/unit/access/post-hooks.test.ts`       | slug numbering / refusal, date stamp                                                                                  |
| `tests/unit/syndication.test.ts`             | the constraint's shape                                                                                                |
| `tests/unit/post-mapper.test.ts`             | `toPost`                                                                                                              |
| `tests/unit/lib/audit.test.ts`               | posts entries                                                                                                         |
| `tests/unit/slug.test.ts`                    | `nextFreeSlug`                                                                                                        |
| `tests/integration/tenant-isolation.test.ts` | `posts` — invariants 1–5 incl. 3 through `listPosts`, the hook layer with access skipped, district-only fields, slugs |
| `tests/integration/graphql.test.ts`          | `posts over GraphQL`                                                                                                  |
| `tests/e2e/admin-planes-axe.spec.ts`         | school: the post form; district: posts list, the post form with chosen sites                                          |

### Not here yet

- The approval queue, its diff and one-click approve; the school task "Post an announcement";
  "Your recent submissions"; the outcome emails — all read `pages` only.
- `FeedBlock`, the post template and its route, revalidation with the syndication fan-out
  (`tagsForDocument`'s `syndicatedTo`).
- `posts.routine` auto-approval.
- `category` and `heroImage` (see `03` §2).
- A migration mapper stub.
