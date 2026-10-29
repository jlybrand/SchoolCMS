# Phase 5 — Core content modules

How the content modules work mechanically, and the audit trail they write to. Phase 5 opens
with the audit trail (`05`, scheduled at the Phase 4 close); the modules — posts, events, people
and the PowerSchool sync, alerts — follow, each writing to it.

| Slice                        | State                                                             |
| ---------------------------- | ----------------------------------------------------------------- |
| Audit trail                  | Merged (#42) — §1                                                 |
| News/announcements (`posts`) | §2–§6 (#43–#47); **this PR** — §7 `posts.routine`. Slice complete |
| Calendars and events         | —                                                                 |
| Directories + PowerSchool    | —                                                                 |
| Alerts                       | —                                                                 |

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

- `FeedBlock`, the post template and its route, revalidation with the syndication fan-out
  (`tagsForDocument`'s `syndicatedTo`).
- `posts.routine` auto-approval.
- `heroImage` (see `03` §2). (`category` is replaced by boards and tags — §4.)
- A migration mapper stub.

---

## 3. Posts through approval — the school task, the queue, the emails

### Files

| File                                    | Holds                                                                                                                                                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/collections/endpoints/approve.ts`  | (was `approve-page.ts`) `ReviewedCollection`, `latestVersion(payload, collection, id)`, `latestVersionToken`, `approveDocument(req, collection, id, seen)`, `makeApproveEndpoint(collection)`, `APPROVE_MESSAGES` |
| `src/admin/Approvals/anchor.ts`         | `approvalAnchor(collection, id)` → `approval-{collection}-{id}`                                                                                                                                                   |
| `src/admin/SchoolPlane/NewPostView.tsx` | `/admin/new-post` — school managers only, else redirect to `/admin`                                                                                                                                               |
| `src/admin/SchoolPlane/NewPostForm.tsx` | headline (+ school when several) → `POST /api/posts?draft=true` → the post form                                                                                                                                   |
| `tests/e2e/announcements.spec.ts`       | the task to the queue; new-post axe; an announcement approved from the queue                                                                                                                                      |

Changed:

| File                                                                             | Change                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/collections/Pages.ts`                                                       | `endpoints: [makeApproveEndpoint('pages')]`; notify gets `collection: 'pages'`                                                                                                                                                                                |
| `src/collections/Posts.ts`                                                       | `endpoints: [makeApproveEndpoint('posts')]`; `makeNotifyReviewOutcome({ collection: 'posts', pathFor: noPath })` after audit; `body` not required; `postNeedsWordsHook` before `stampPublishedDateHook`; `publishedDate` hidden when `sendsForApproval(user)` |
| `src/collections/hooks/post-hooks.ts`                                            | `postNeedsWords`, `postNeedsWordsHook`                                                                                                                                                                                                                        |
| `src/collections/hooks/notify-review-outcome.ts`                                 | `NotifyDeps.collection`; `pathFor` may return null; `noPath`                                                                                                                                                                                                  |
| `src/lib/review-emails.ts`                                                       | `OutcomeEmailInput.noun` (`page` default / `announcement`); `pageUrl: string \| null`                                                                                                                                                                         |
| `src/lib/district-digest.ts`, `src/jobs/district-digest.ts`                      | `WaitingPage.kind`; both collections read and merged by `submittedAt`; counts say "submission(s)"                                                                                                                                                             |
| `src/admin/Approvals/page-diff.ts`                                               | `diffPost`; shared `diffFields`                                                                                                                                                                                                                               |
| `src/admin/Approvals/queue-data.ts`                                              | `QueueItem.collection`, `.noun`; `countWaiting` and `loadQueue` over pages + posts                                                                                                                                                                            |
| `src/admin/Approvals/ApprovalItem.tsx`, `ApprovalsView.tsx`, `WaitingBanner.tsx` | URLs per collection; "New announcement" / "Announcement" badge; "Open the announcement"; "submission(s)"                                                                                                                                                      |
| `src/admin/SendForApproval/review-status.ts`                                     | `NEEDS_WORDS`, `sendRefusal(collection, body)`                                                                                                                                                                                                                |
| `src/admin/SendForApproval/SendForApprovalButton.tsx`                            | queue link uses `approvalAnchor`; `sendRefusal` checked before submit (`toast.error`)                                                                                                                                                                         |
| `src/admin/SchoolPlane/school-plane.ts`                                          | "Post an announcement" first in `SCHOOL_TASKS`; `checkNewPost`; `explainPostCreateError`; `schoolEditPath`                                                                                                                                                    |
| `src/admin/SchoolPlane/school-data.ts`, `SchoolHome.tsx`                         | recent submissions over pages + posts, newest first, 20; rows carry `collection`                                                                                                                                                                              |
| `src/payload.config.ts`                                                          | view `newPost` at `/new-post`                                                                                                                                                                                                                                 |

### Approve

`POST /api/{pages|posts}/:id/approve` with `{ versionId, updatedAt }` → `approveDocument`: district
admin only; `latestVersion` of THAT collection; `checkApproval`; `payload.update` of that
collection as the reviewer with the version's content and `_status: 'published'`. A token read
from one collection never matches the other's versions.

Messages: `forbidden` "Only district staff can approve changes."; `not-waiting` "This is no
longer waiting…"; `changed` "This was changed after you opened it…"; `not-found` "This no longer exists."

### Queue

`loadQueue` reads each collection's `reviewState = submitted` (as the reviewer, `draft: true`,
50 each), merges by `submittedAt` ascending, keeps 50. Pages diff with `diffPage` (parent titles
resolved from pages only); posts with `diffPost`: Headline, Address (the slug alone — no public
path yet), Summary, Who can see it, then the body. Approved announcement outcome: "Published.
“{title}” is approved for {school}."

### Words required to send

| Write                                                                | `postNeedsWords` |
| -------------------------------------------------------------------- | ---------------- |
| `reviewState: submitted` over a stored state that is not `submitted` | needs words      |
| `_status: published`                                                 | needs words      |
| anything else (create, autosave, a save on a waiting post)           | passes           |

Words = `toRichText(body ?? stored body).length > 0`. Refusal: `ValidationError` on `body` with
`NEEDS_WORDS`. The button checks the same (`sendRefusal`) before submitting, because a refused
submit made before the Lexical editor mounts leaves it `contenteditable="false"` until reload
(Payload 3.87; reproduced in e2e), and the production build replaces the server message.

### Emails

| Collection | Approved                                          | Changes requested                                                 |
| ---------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| pages      | "Your page is live: {title}" + public URL         | as before                                                         |
| posts      | "Your announcement is approved: {title}", no link | "…your announcement “{title}”…" + `/admin/collections/posts/{id}` |

Digest lines: `{title} (announcement) — {school} — {wait}` for posts.

### Not here yet

- `FeedBlock`, the post template and route, revalidation with syndication fan-out — and with
  them a public address for the approval email and the diff's Address row.
- Editing an announcement after it is published: there is no school task for it; a school
  manager reaches it only from "Your recent submissions" while it is pending.
- "Published" in recent submissions (reads the audit trail).

---

## 4. Folders, boards and tags (Jason, 2026-10-28)

### Files

| File                             | Holds                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/collections/PostFolders.ts` | `post-folders` — tenant-scoped; `name`; `retitleBoards` (afterChange)                           |
| `src/collections/PostBoards.ts`  | `post-boards` — tenant-scoped; `folder`, `name`, hidden `title`; `placeInFolder` (beforeChange) |
| `src/collections/PostTags.ts`    | `post-tags` — district-wide; `name` (unique)                                                    |
| `src/access/post-structure.ts`   | `schoolListReadAccess` (folders, boards), `staffReadAccess` (tags)                              |

Changed:

| File                                                | Change                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/collections/Posts.ts`                          | `board` (relationship, required, `filterOptions` same tenant); `tags` (hasMany, not sortable); `boardIsThisSchools` last in beforeValidate             |
| `src/collections/hooks/post-hooks.ts`               | `boardIsThisSchools`, `boardTitle`                                                                                                                     |
| `src/content/syndication.ts`                        | `FeedFilter`, `feedConstraint(tenantId, { boards, tags })`                                                                                             |
| `src/content/posts.ts`                              | `listPosts(ctx, { limit, boards, tags })` → `feedConstraint`                                                                                           |
| `src/content/types.ts`, `post-mapper.ts`            | `Post.boardId`, `Post.tagIds`                                                                                                                          |
| `src/admin/Approvals/page-diff.ts`, `queue-data.ts` | Board and Tags rows; names read from `post-boards.title` / `post-tags.name`                                                                            |
| `src/admin/SchoolPlane/*`                           | `checkNewPost({ title, boards, board })`; `listMyBoards`; the form asks "Which board is this for?" when there are several and sends `tenant` + `board` |
| `src/admin/A11yPatch/repairs.ts`                    | names Payload's list "someone is editing" lock from its tooltip                                                                                        |
| `src/payload.config.ts`                             | the three collections; `post-folders` and `post-boards` in the multi-tenant plugin                                                                     |
| `scripts/seed.ts`                                   | per site, when it has no boards: a folder named after it + a "News" board; tags Elementary, Middle, High when absent                                   |
| `tests/helpers/payload.ts`                          | `Fixtures.boardDistrict/boardA/boardB`; `boardFor(f, tenant)`                                                                                          |

### Access

|                                             | District admin | School manager                      | Sync | Anonymous |
| ------------------------------------------- | -------------- | ----------------------------------- | ---- | --------- |
| folders, boards — read                      | all            | `{ tenant: { in: their schools } }` | no   | no        |
| tags — read                                 | yes            | yes                                 | no   | no        |
| any of the three — create / update / delete | yes            | no                                  | no   | no        |

### Rules

- A board's folder is of the board's site (`placeInFolder`, `ValidationError` on `folder`).
  `title` = `boardTitle(folder.name, name)` = "Folder → Board"; renaming a folder rewrites its
  boards' titles.
- A post's board is of the post's site: Payload validates `filterOptions` on the server for
  every writer, and `boardIsThisSchools` refuses it again with "Choose one of this school's boards."
- `feedConstraint(T, { boards, tags })` = `and: [syndicationConstraint(T), published, public,
board in boards?, tags in tags?]`. Empty lists are no filter.

### New announcement

| Boards the user may post to | The form                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| none                        | "Your school has no boards for announcements yet. Ask the district web team to set one up."                                |
| one                         | not asked                                                                                                                  |
| several                     | "Which board is this for?" — radios labelled "Folder → Board" (with "School · " in front for a manager of several schools) |

The school is the chosen board's.

### Tests

`tests/unit/access/post-structure.test.ts`; `post-hooks.test.ts` (`boardIsThisSchools`,
`boardTitle`); `syndication.test.ts` (`feedConstraint`); `post-mapper.test.ts`;
`page-diff.test.ts` (Board, Tags); `school-plane.test.ts` (`checkNewPost`); `a11y-patch.test.ts`
(the lock); `tenant-isolation.test.ts` "announcement folders, boards and tags"; `graphql.test.ts`;
`announcements.spec.ts` (two boards); `admin-planes-axe.spec.ts` (boards, folders, tags lists; a
board; the post form with board and tag chips).

---

## 5. Announcements on the public site (Jason, 2026-10-28)

`/news/{slug}` on the announcement's HOME site; `/news` lists a site's own announcements and
those shared with it. A shared one links to its home site — one address per announcement.

### Files

| File                                                                | Holds                                                                                                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/(frontend)/sites/[hostname]/[locale]/site.tsx`             | `resolveSite(params)` → `Site \| null`; `SiteFrame` (header, `<main data-cache-tag>`, footer; reads navigation)                                |
| `src/app/(frontend)/sites/[hostname]/[locale]/news/page.tsx`        | `/news` — `listPosts(ctx, { limit: 50 })` → `toNewsItems` → `NewsList` (h2 headlines); tags `tenant:{id} collection:posts`                     |
| `src/app/(frontend)/sites/[hostname]/[locale]/news/[slug]/page.tsx` | `/news/{slug}` — `getPostBySlug`; h1, `PublishedDate`, `RichText`, "All news"; tags `tenant:{id} posts:{id}`                                   |
| `src/lib/post-url.ts`                                               | `NEWS_PATH`, `postPath(slug)`, `postHref(post, { siteTenantId, locale, serverUrl })`, `formatPostDate(iso, locale)`, `toNewsItems`, `NewsItem` |
| `src/components/NewsList/`                                          | list of `NewsItem`; headline per item at `level`; `empty` sentence                                                                             |
| `src/components/PublishedDate/`                                     | `<p><time dateTime>label</time></p>`                                                                                                           |
| `tests/e2e/news-pages.spec.ts`                                      | list → article; 404s; district post on a school's list within seconds; axe both themes                                                         |

Changed:

| File                                             | Change                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `[[...segments]]/page.tsx`                       | uses `resolveSite` + `SiteFrame`                                                     |
| `sitemap/route.ts`                               | adds `NEWS_PATH` and `listPostPaths`                                                 |
| `src/content/posts.ts`                           | `getPostBySlug(ctx, slug)`, `listPostPaths(ctx)`; `listPosts` fills `homeHostname`   |
| `src/content/types.ts`, `post-mapper.ts`         | `Post.homeHostname` (mapper: null)                                                   |
| `src/lib/slug.ts`, `src/collections/Pages.ts`    | `isReservedTopLevelSlug` — `news` refused for a page with no parent                  |
| `src/collections/hooks/revalidate-on-publish.ts` | `targetsFor` dep; `syndicationTargets(doc, previous, all)`; `allTenantIds`           |
| `src/collections/Posts.ts`                       | revalidate on publish with `syndicationTargets`; notify `pathFor` = `postPath(slug)` |
| `src/lib/review-emails.ts`                       | announcement approval links to it when `pageUrl` is given                            |
| `src/admin/Approvals/page-diff.ts`               | Address shows `/news/{slug}`                                                         |

### Links

| Shown on                   | Post's home | `postHref`                                                                            |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| its home site              | this site   | `localizedPath('/news/{slug}', locale)`                                               |
| another site               | elsewhere   | `publicUrlFor(NEXT_PUBLIC_SERVER_URL, homeHostname, '/news/{slug}')` (default locale) |
| another site, home unknown | —           | null (headline unlinked)                                                              |

### Reads

| Function                   | Where                                                         |
| -------------------------- | ------------------------------------------------------------- |
| `getPostBySlug(ctx, slug)` | `tenant = ctx.tenant`, published, public, `slug`              |
| `listPostPaths(ctx)`       | `tenant = ctx.tenant`, published, public → `/news/{slug}`     |
| `listPosts(ctx, filter)`   | `feedConstraint` (§4) + one `tenants` read for home hostnames |

### Revalidation

On a publish, `revalidatePath('/sites/{hostname}', 'layout')` for each of
`syndicationTargets(doc, previousDoc, allTenantIds)`: owner; every tenant for `district-wide`;
`syndicatedTo` for `selected`; the same for `previousDoc` (a site it was taken off). A draft
write revalidates nothing.

### Not here yet

- Pagination or an archive past 50 on `/news`.

---

## 6. `FeedBlock` and the resolve pass (Jason, 2026-10-28)

### Files

| File                                    | Holds                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/content/resolve-blocks.ts`         | `resolvePageBlocks(ctx, blocks, { serverUrl })` → `ResolvedPageBlock[]`                                |
| `src/blocks/NewsFeed/`                  | `NewsFeed` — renders a `ResolvedFeedBlock`; story                                                      |
| `src/lib/cross-tenant-relationships.ts` | `crossTenantRelationships(config)` — last in `plugins`                                                 |
| `tests/e2e/news-feed.spec.ts`           | a feed on School B's page: shared district news, link home, refresh on publish, hidden when empty, axe |

Changed:

| File                                             | Change                                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/content/types.ts`                           | `FeedBlock` (stored), `ResolvedFeedBlock`, `PageBlock` + feed, `ResolvedPageBlock`                                                     |
| `src/content/blocks.ts`                          | `toFeed`: boards (≥1, else dropped), tags, heading, `limit` 1–10 (default 5)                                                           |
| `src/collections/blocks/index.ts`                | `feedBlock` (slug `feed`, "News feed"): heading, boards (required, not sortable, `custom.crossTenant`), tags (not sortable), limit     |
| `src/blocks/BlockList.tsx`                       | `blocks: ResolvedPageBlock[]`; `case 'feed'`; drops a feed with no items                                                               |
| `[[...segments]]/page.tsx`                       | `resolvePageBlocks(ctx, page.layout, { serverUrl })` before `BlockList`                                                                |
| `src/collections/PostBoards.ts`, `post-hooks.ts` | `label` = `boardLabel(site name, title)` = "Site · Folder → Board"; `useAsTitle: 'label'`                                              |
| `src/admin/A11yPatch/repairs.ts`                 | names `.collapsible__drag` "Reorder", `.array-actions__button` "Row actions", `.clipboard-action__popup .popup-button` "Copy or paste" |
| `src/app/(payload)/admin-overrides.css`          | `.blocks-field__drawer-toggler:not(:disabled) .btn` colour                                                                             |
| `src/payload.config.ts`                          | `crossTenantRelationships` after `multiTenantPlugin`                                                                                   |

### The two passes

| Stage               | Input         | Output                                                                                                 | Pure             |
| ------------------- | ------------- | ------------------------------------------------------------------------------------------------------ | ---------------- |
| `toPageBlocks`      | `layout` rows | `PageBlock[]` — a feed is its settings                                                                 | yes              |
| `resolvePageBlocks` | `PageBlock[]` | `ResolvedPageBlock[]` — a feed is `{ heading, items: NewsItem[], moreHref }`; an empty feed is dropped | no (reads posts) |

Feed → `listPosts(ctx, { boards, tags, limit })` → `toNewsItems(posts, { siteTenantId, locale, serverUrl })`; `moreHref` = `localizedPath('/news', locale)`.

### Rendering

`NewsFeed`: with a heading, a `Section` named by it at the block level and headlines one level
below; without, headlines at the block level. Then "More news". Nothing for no items.

### Cross-site boards

`multiTenantPlugin` wraps every relationship to `post-boards` with the document's-site filter
(picker and validation). `crossTenantRelationships` restores `custom.filterOptions` (or none) on
fields with `custom.crossTenant === true` — only the feed's `boards`. A post's `board` keeps the
plugin's filter and `boardIsThisSchools`.

### Tests

`blocks.test.ts` (feed mapper), `components/blocks.test.tsx` (NewsFeed), `cross-tenant-relationships.test.ts`,
`post-hooks.test.ts` (`boardLabel`), `a11y-patch.test.ts` (row controls), `content-layer.test.ts`
(`resolvePageBlocks`), `tenant-isolation.test.ts` (a feed may pick the district's board; a post
may not; a school manager cannot add a feed), `news-feed.spec.ts`, `admin-planes-axe.spec.ts`
("a page with a news feed").

---

## 7. `posts.routine` — the first auto-approval that acts (Jason, 2026-10-28)

### Files

| File                                    | Holds                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/collections/hooks/auto-approve.ts` | `autoApprovePost` (afterChange, last on posts); `AUTO_APPROVAL`, `autoApprovalOf(req)`, `AutoApprovalMark` |
| `tests/e2e/posts-routine.spec.ts`       | a grant holder (School B) posts through the form → live; `/news`; the district's 30-day list; axe          |

Changed:

| File                                                                  | Change                                                                                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/access/auto-approval.ts`                                         | `AUTO_APPROVAL_RULES.posts`; `POST_JUDGED_FIELDS`; `NEW_POST_BASELINE`; `changedFields(before, after, fields, defaults)`                      |
| `src/collections/hooks/publish-gate.ts`                               | a `_status: published` write (not `publishAt`) with `autoApprovalOf(req)` passes                                                              |
| `src/collections/hooks/review-state.ts`                               | with `autoApprovalOf(req)` and publishing: review fields cleared                                                                              |
| `src/collections/hooks/notify-review-outcome.ts`                      | with `autoApprovalOf(req)`: no email                                                                                                          |
| `src/collections/hooks/audit.ts`, `src/lib/audit.ts`                  | `AuditInput.autoApproval`; a publish with it → `auto-approve`, `autoApproved: true`, summary `Under the grant “{label}”`                      |
| `src/admin/SendForApproval/review-status.ts`, `ReviewStatusField.tsx` | `_status` input; published with nothing pending → "This is live on the website"                                                               |
| `src/admin/Grants/grants.ts`, `grant-data.ts`, `GrantsPanel.tsx`      | `autoApprovalRows`, `findRecentAutoApprovals` (as the viewer, `SPOT_CHECK_DAYS` = 30, newest first, 100), "Auto-approved in the last 30 days" |
| `starterDocs/04-authoring-model-approval-workflow.md`                 | §4.3 records the exception                                                                                                                    |

### The rule

|                 |                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------- |
| scope           | `posts.routine`                                                                                     |
| `neverFields`   | `heroImage`, `visibility`, `syndication`, `publishedDate`, `requiresTranslationReview` — NOT `body` |
| `createAllowed` | true                                                                                                |
| `permits`       | `isCreate` or `slug` unchanged                                                                      |

### The flow

1. A school manager's write moves `reviewState` to `submitted` (the send). Its hooks run as
   before; `auditChange` writes `submit`.
2. `autoApprovePost` (last): no applicable posts scope → done. Else reads the main row
   (`draft: false`); `isCreate` = it is not published; `changedFields(live or NEW_POST_BASELINE,
doc, POST_JUDGED_FIELDS, NEW_POST_BASELINE)`; `decideAutoApproval`.
3. Approve → sets `req.context.autoApproval = { scope }`, `payload.update({ data: version content +
_status: published, draft: false, overrideAccess: true, req })` — same transaction — returns
   the published doc, then deletes the mark.
4. The nested publish's hooks: `publishGate` and `applyReviewState` pass on the mark;
   `postNeedsWords`, `stampPublishedDate` as usual; `auditChange` writes `auto-approve`;
   revalidation fans out; no email.

A failure in step 3 fails the send (Payload rolls the shared transaction back); nothing is
half-published.

### Tests

`tests/unit/access/auto-approval.test.ts` (`posts.routine`, `changedFields`, the body-only
exception guard); `publish-gate.test.ts`, `review-state-hook.test.ts`,
`notify-review-outcome.test.ts` (the mark); `tests/unit/lib/audit.test.ts`;
`send-for-approval.test.ts` (live status); `grants.test.ts` (`autoApprovalRows`);
`tests/integration/auto-approval.test.ts` (`posts.routine` block — mutation-checked: removing the
hook, the gate exception, or `visibility` from the never list each fails it); `posts-routine.spec.ts`.

---

## 8. The district's boards screen (Jason, 2026-10-28)

`/admin/collections/post-boards` renders `BoardsListView` (`src/admin/Boards/`) instead of Payload's
flat list — `admin.components.views.list.Component` on `PostBoards`.

| File                                                                   | Holds                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/admin/Boards/board-tree.ts`                                       | `boardTree(sites, folders, boards)` → `SiteNode[]` (pure): sites, folders, boards each by name; boards whose folder is unknown under "Boards with no folder"                                                                                                                                                                  |
| `src/admin/Boards/BoardsListView.tsx`                                  | district only (else redirect `/admin`); tenants read as the platform, folders and boards as the viewer; `h1` "Announcement boards"; "Add a folder", "Add a board"; per site a `section` named by its `h2`; per folder a `<details>`/`<summary>` "{folder} ({n} boards)" holding board links and "Rename or remove the folder" |
| `src/admin/Boards/Boards.module.css`                                   | Payload theme variables; logical properties                                                                                                                                                                                                                                                                                   |
| `tests/unit/admin/board-tree.test.ts`, `tests/e2e/boards-view.spec.ts` | grouping; open a folder → pick a board; keyboard open/close; add links                                                                                                                                                                                                                                                        |

`admin-planes-axe.spec.ts`: "announcement boards, folders open" (every `<details>` opened before the
audit) and "a board" (reached by opening a folder).

## 9. Page permalinks and menu links to a page (Jason, 2026-10-29)

Every page answers at `/dd2/pages/<id>`; menu links may store a page instead of an address. Both
resolve the page id to its current path, so a rename or a move breaks neither.

### Files

| File                                                                   | Does                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/lib/permalink.ts`                                                 | `PERMALINK_SEGMENT` (`dd2`), `permalinkPath(id)`, `parsePermalinkId(raw)`                |
| `src/lib/slug.ts`                                                      | `dd2` joins `RESERVED_TOP_LEVEL_SLUGS`                                                   |
| `src/content/page-tree.ts`                                             | pure `segmentsFor` / `pathIndex(rows)` — id → current path                               |
| `src/content/pages.ts`                                                 | `listPagePathIndex(ctx)`, `getPagePathById(ctx, id)`; `listPagePaths` uses `segmentsFor` |
| `src/app/(frontend)/sites/[hostname]/[locale]/dd2/pages/[id]/route.ts` | GET → 302 `Location: localizedPath(path, locale)`, or 404                                |
| `src/content/menus.ts`                                                 | `toNavigation(doc, paths)`; `linksToPages(doc)`                                          |
| `src/content/navigation.ts`                                            | reads `listPagePathIndex` only when a menu has a page link                               |
| `src/collections/Navigation.ts`                                        | link fields `linkType` (`page` \| `address`), `page`, `href`                             |
| `src/lib/menu-page-link.ts`                                            | `validateMenuPageLink` — page required on a page link, and on the menu's site            |
| `src/admin/Permalink/PermalinkField.tsx`                               | `ui` field in the page sidebar showing `/dd2/pages/<id>`                                 |

### The flow

1. `/dd2/pages/12` on `a.localhost` → proxy rewrites to `/sites/a.localhost/en/dd2/pages/12` → `route.ts`.
2. `parsePermalinkId` refuses anything but a positive integer with no leading zero → 404.
3. `resolveSite` (unknown host or locale → 404) → `getPagePathById` → `listPagePathIndex`:
   one query for the tenant's published, public pages (`slug`, `parent`), then `pathIndex`.
4. No path (missing, draft, staff-only, other site, unreachable) → 404; else 302 to the path,
   locale-prefixed. `revalidate = 3600`; any page publish purges the site layout-deep.

Menus: a row with `linkType: 'page'` takes `paths.get(pageId)` and ignores `href`; no path →
dropped. A row with no `linkType` (saved before the field) is an address. New links default
to `page`.

### Tests

- `tests/unit/lib/permalink.test.ts`, `tests/unit/page-tree.test.ts`,
  `tests/unit/lib/menu-page-link.test.ts`, `tests/unit/menus.test.ts` (page links)
- `tests/integration/content-layer.test.ts` — `getPagePathById` (move, draft, staff, other
  site), `getNavigation` page links, cross-site menu link refused on write
- `tests/e2e/page-permalinks.spec.ts` — 302 before and after rename + move; 404s; sidebar
  field + axe in both themes
