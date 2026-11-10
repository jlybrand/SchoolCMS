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
| `src/admin/SchoolPlane/NewPostView.tsx` | `/admin/new-post` — forwards to the announcements screen with the headline showing (§17)                                                                                                                          |
| `src/admin/SchoolPlane/NewPostForm.tsx` | headline (+ board when several) → `POST /api/posts?draft=true` → the post form; shown on the announcements screen (§17)                                                                                           |
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
| `src/admin/Approvals/queue-data.ts`                                              | `QueueItem.collection`, `.noun`; `loadQueue` over pages + posts (`countWaiting` removed, §18)                                                                                                                                                                 |
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

| File                                                | Change                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/collections/Posts.ts`                          | `board` (relationship, required, `filterOptions` same tenant); `tags` (hasMany, not sortable); `boardIsThisSchools` last in beforeValidate |
| `src/collections/hooks/post-hooks.ts`               | `boardIsThisSchools`, `boardTitle`                                                                                                         |
| `src/content/syndication.ts`                        | `FeedFilter`, `feedConstraint(tenantId, { boards, tags })`                                                                                 |
| `src/content/posts.ts`                              | `listPosts(ctx, { limit, boards, tags })` → `feedConstraint`                                                                               |
| `src/content/types.ts`, `post-mapper.ts`            | `Post.boardId`, `Post.tagIds`                                                                                                              |
| `src/admin/Approvals/page-diff.ts`, `queue-data.ts` | Board and Tags rows; names read from `post-boards.title` / `post-tags.name`                                                                |
| `src/admin/SchoolPlane/*`                           | `checkNewPost({ title, boards, board })`; the form asks "Which board is this for?" when there are several and sends `tenant` + `board`     |
| `src/admin/A11yPatch/repairs.ts`                    | names Payload's list "someone is editing" lock from its tooltip                                                                            |
| `src/payload.config.ts`                             | the three collections; `post-folders` and `post-boards` in the multi-tenant plugin                                                         |
| `scripts/seed.ts`                                   | per site, when it has no boards: a folder named after it + a "News" board; tags Elementary, Middle, High when absent                       |
| `tests/helpers/payload.ts`                          | `Fixtures.boardDistrict/boardA/boardB`; `boardFor(f, tenant)`                                                                              |

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
| `src/lib/page-link.ts`                                                 | `validatePageLink` — page required on a page link, and on the owner's site (§10)         |
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
  `tests/unit/lib/page-link.test.ts`, `tests/unit/menus.test.ts` (page links)
- `tests/integration/content-layer.test.ts` — `getPagePathById` (move, draft, staff, other
  site), `getNavigation` page links, cross-site menu link refused on write
- `tests/e2e/page-permalinks.spec.ts` — 302 before and after rename + move; 404s; sidebar
  field + axe in both themes

## 10. Buttons, cards and links in the words that point at a page (Jason, 2026-10-29)

The call-to-action button, each card, and the editor's "internal link" can store a page instead
of an address, and render with the path the page has today — the same path index as §9.

### Files

| File                                     | Does                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/collections/fields/link.ts`         | `linkFields({ owner, optional, hrefDescription })` — `linkType`, `page`, `href`; used by menus, the call to action and cards |
| `src/lib/page-link.ts`                   | `validatePageLink` — page required on a page link, and on the owner's site (was `menu-page-link.ts`)                         |
| `src/lib/editor.ts`                      | `LinkFeature({ enabledCollections: ['pages'], maxDepth: 0 })`                                                                |
| `src/content/page-tree.ts`               | `PagePaths`, `NO_PAGE_PATHS`, `pageIdOf`, `pathOfPage`                                                                       |
| `src/content/rich-text.ts`               | `toRichText(state, paths?)` — `linkType: 'internal'` + `doc.relationTo: 'pages'` → path                                      |
| `src/content/blocks.ts`                  | `toPageBlocks(layout, paths?)` — call to action, cards, and the words in text and accordion blocks                           |
| `src/content/pages.ts`                   | `getPageByPath` reads `listPagePathIndex`; `listPagePaths` builds the map from its own rows                                  |
| `src/content/post-mapper.ts`, `posts.ts` | `toPost(row, paths?)`; `getPostBySlug` passes the home site's paths                                                          |

### Rules

- `linkType: 'page'` → `paths.get(pageId)`; a stored `href`/`url` beside it is ignored.
- No current path (draft, staff-only, deleted, other site): the call to action is dropped, a
  card keeps its title without a link, a link in the words keeps its words.
- `linkType: 'none'` (cards only, the default) → no link. No `linkType` → an address.
- Callers that only measure or diff the words (`review-status.ts`, `page-diff.ts`) pass no paths.
- The editor's page picker is not filtered by site; a link to another site's page renders as
  words.

### Tests

- `tests/unit/rich-text.test.ts`, `tests/unit/blocks.test.ts` (links to a page),
  `tests/unit/lib/page-link.test.ts`
- `tests/integration/content-layer.test.ts` — body + button on a page (by path and build
  list), cross-site button refused, announcement body
- `tests/e2e/page-permalinks.spec.ts` — button and words follow a renamed page
- `tests/e2e/admin-planes-axe.spec.ts` — a page with a button and cards linking to pages

## 11. Hide from navigation and from search engines (Jason, 2026-10-29)

Two district-only checkboxes in the page sidebar (Finalsite's "hide from navigation elements" and
"hide from external search engines").

### Files

| File                                                   | Does                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `src/collections/Pages.ts`                             | `hideFromNavigation`, `hideFromSearchEngines` — `districtOnlyField` access; hidden from the school plane by `condition` |
| `src/content/pages.ts`                                 | `inNavigation(doc)` filters `childrenOf` and `listPagePaths`' child lists; `Page.hideFromSearchEngines`                 |
| `src/lib/seo.ts`                                       | `robots.index = indexable && !page.hideFromSearchEngines`; `follow = indexable`                                         |
| `src/app/(frontend)/sites/[hostname]/sitemap/route.ts` | leaves out pages hidden from search engines                                                                             |

### Rules

- Hidden from navigation: out of `Page.children` (so `ChildPageNav` and section menus); still
  served at its path, still in `listPagePaths`, the sitemap and permalinks; hand-added menu links
  unaffected. Null (rows before the field) counts as shown.
- Hidden from search engines: served; `<meta name="robots" content="noindex, follow">`; not in
  the sitemap. On a closed site both halves stay off.
- Hide from the site's own search: not built — Phase 6 search.

### Tests

- `tests/unit/seo.test.ts` (robots), `tests/integration/content-layer.test.ts` (children, build
  list, served, flag), `tests/integration/tenant-isolation.test.ts` (school manager cannot set
  either), `tests/e2e/page-options.spec.ts` (noindex + sitemap on School B)

## 12. Linked pages — internal redirect (Jason, 2026-10-29)

A district-only Page setting (§13): visiting the page sends the visitor to a page on the same site
or a district page. Never an outside address. "Reuse content" is the next PR.

### Files

| File                                                                    | Does                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/collections/Pages.ts`                                              | `linkMode` (`none` \| `redirect`), `linkTo` (`site` \| `district`), `linkTarget`, `districtLinkTarget` (`custom.crossTenant`, filter `tenant.type = district`); district-only; `linkMode` list column |
| `src/lib/linked-page.ts`                                                | `validateLinkTarget`, `redirectHref(target, currentHost, locale, port?)`, `isLocalHost`                                                                                                               |
| `src/collections/hooks/linked-page.ts`                                  | `validateLinkMode` — looks up the target, reads omitted fields from the stored page                                                                                                                   |
| `src/content/pages.ts`                                                  | `resolveRedirects` → `Page.redirect` (`{ path, hostname }` \| null); `isLive` drops dead-end linked pages from the resolver, children and `listPagePaths`                                             |
| `src/app/(frontend)/sites/[hostname]/[locale]/[[...segments]]/page.tsx` | `redirect()` (307); `localPort` reads `host` only between `*.localhost` sites; no metadata                                                                                                            |
| `src/app/(frontend)/sites/[hostname]/sitemap/route.ts`                  | leaves out linked pages                                                                                                                                                                               |
| `src/collections/hooks/revalidate-on-publish.ts`                        | `pageRevalidationTargets` — own site + sites of pages linked to it                                                                                                                                    |
| `src/admin/LinkedPage/`                                                 | `LinkedIcon`, `LinkedPageCell` ("Linked" + chain mark); also on "Update a page"                                                                                                                       |

### Rules

- Target required; not the page itself; "this site" = same tenant; "district" = a district
  page; not itself a linked page (no chains or loops).
- Target not live (draft, staff-only, deleted): the linked page 404s and leaves the section menus
  and the build list.
- A target's publish revalidates every site with a page linked to it.

### Tests

- `tests/unit/lib/linked-page.test.ts`
- `tests/integration/content-layer.test.ts` (both targets, build list, dead end, refusals),
  `tests/integration/linked-page-revalidation.test.ts`, `tests/integration/tenant-isolation.test.ts`
- `tests/e2e/linked-pages.spec.ts` — 307s, sitemap, rename follows, 404, the "Linked" mark + axe
  on both planes in both themes

## 13. The district page toolbar and Page settings (Jason, 2026-10-29)

His Finalsite workflow: the page's contents, and along the bottom History, Clone, Delete,
Unpublish and a gear opening Page settings. District only, saved pages only; school managers'
forms are unchanged. Save and Publish stay in Payload's header.

### Files

| File                                             | Does                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/admin/PageToolbar/PageToolbar.tsx`          | `ui` field `pageToolbar` (last in main): History link → `/versions`; Clone → `POST /api/pages/:id/duplicate`; Delete → `ConfirmationModal` + `DELETE`; Unpublish → `ConfirmationModal` + `PATCH { _status: 'draft' }`; the gear                                                                     |
| `src/admin/PageToolbar/PageSettingsHeader.tsx`   | `pageSettingsHeader` (first in main): heading, Close, the "needs a title/address" alert; `PageSettingsFooter` (last in sidebar): Done                                                                                                                                                               |
| `src/admin/PageToolbar/page-settings.ts`         | `SETTING_CLASS`, `SETTING_PATHS`, `REQUIRED_SETTINGS`, `missingRequired`, events                                                                                                                                                                                                                    |
| `src/admin/PageToolbar/page-settings.css`        | global: hides `.dd2-page-setting` when `.document-fields:has(#page-toolbar)`; `[data-page-settings='open']` turns `.document-fields` into the dialog showing only them                                                                                                                              |
| `src/collections/Pages.ts`                       | `admin.className: SETTING_CLASS` on title, slug, pageType, parent, visibility, meta, publishAt, linkMode, linkTo, linkTarget, districtLinkTarget, hideFromNavigation, hideFromSearchEngines (+ `PermalinkField`); `beforeDuplicate` on title (`(copy)`), slug (`freeSlugForCopy`), publishAt (null) |
| `src/collections/hooks/revalidate-on-publish.ts` | `stillLive` dep + `liveStillPublished(collection)` — an unpublish revalidates (pages, posts)                                                                                                                                                                                                        |

### The dialog

- Opening sets `data-page-settings`, `role="dialog"`, `aria-modal`, `aria-labelledby` on
  `.document-fields`, makes every element outside it `inert`, focuses the heading.
- Close, Done and Escape close it and return focus to the gear — unless title or slug is empty
  (`missingRequired`): it stays, alerts, and focuses the field.
- A setting with `valid === false` in form state opens it.
- Payload renders a group's fields as they near the view (`RenderIfInViewport`), so the search
  fields appear as the dialog is scrolled.

### Tests

- `tests/unit/admin/page-settings.test.ts`, `tests/unit/access/revalidate-on-publish.test.ts`
  (unpublish), `tests/integration/page-clone.test.ts`,
  `tests/integration/linked-page-revalidation.test.ts` (`liveStillPublished`)
- `tests/e2e/page-toolbar.spec.ts` — closed/open + axe in both themes, Escape and focus, the
  address change, the required-title guard, History, Clone, Delete, Unpublish (404 at once), the
  school form unchanged; `tests/e2e/support/page-settings.ts` (`openPageSettings`)

## 14. Linked pages — reuse content (Jason, 2026-10-29)

`linkMode: 'reuse'`: the page shows a DISTRICT page's title and content at its own address.
District picker only (`districtLinkTarget`); district-only, in Page settings (§13).

### Files

| File                                                                    | Does                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/linked-page.ts`                                                | `validateLinkTarget` for `reuse` (district page, not itself, not linked); `withLocalPort`                                                                                                 |
| `src/content/pages.ts`                                                  | `resolveLinks` (was `resolveRedirects`) → `{ redirect }` or `{ reuse: from, source, paths }`; `toDomain` takes the source's title, body, layout, SEO text; `menuTitle`; `Page.reusedFrom` |
| `src/content/rehome-links.ts`                                           | `mapRichTextLinks`, `mapBlockLinks`; `rehomeRichText`/`rehomeBlocks` give paths the district origin                                                                                       |
| `src/lib/seo.ts`                                                        | canonical + language alternates → the district original when `reusedFrom`; OG `url` stays the school's                                                                                    |
| `src/app/(frontend)/sites/[hostname]/[locale]/[[...segments]]/page.tsx` | renders the reused page; between `*.localhost` sites adds the visitor's port to its district links                                                                                        |
| `src/app/(frontend)/sites/[hostname]/sitemap/route.ts`                  | leaves out reuse pages                                                                                                                                                                    |

### Rules

- Source: a published, public district page that is not itself linked; else the reuse page 404s
  and leaves menus and the build list.
- The school page keeps its address, place in the tree, children, visibility and hide options;
  title, words, sections and search text are the district page's. Menus name it by the district
  title.
- Links in the reused content that are paths become district addresses; full addresses,
  `mailto:` and `tel:` are unchanged. Data blocks (feeds) resolve for the school's site.
- A source's publish revalidates every site reusing it (`pageRevalidationTargets`, §12).

### Tests

- `tests/unit/lib/linked-page.test.ts` (reuse, `withLocalPort`), `tests/unit/rehome-links.test.ts`,
  `tests/unit/seo.test.ts` (canonical)
- `tests/integration/content-layer.test.ts` — reuse by path and build list, menu title, dead
  source, school-page source refused
- `tests/e2e/linked-pages.spec.ts` — the school page shows the district's heading and words,
  links to the district site, canonical, not in the sitemap, follows an edit; Page settings with
  reuse chosen + axe in both themes

## 15. Board-first announcements for the district (Jason, 2026-10-29)

> **Superseded by §17** (2026-11-04): the "New announcement" link now opens the announcements
> screen on that board with the headline showing; `new-post-route.ts` is gone and `boardById`
> takes `(payload, user, id)`. Kept below as the record of what shipped in #61.

Finalsite is board-first: open a board, then create a post on it. The boards screen (§8) gives each
board a "New announcement" link to `/admin/new-post?board=<id>`; the school's new-post screen (§3)
serves the district with the board fixed.

| File                                      | Holds                                                                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/admin/SchoolPlane/new-post-route.ts` | `newPostRoute(user, board)` (pure): school manager → `school`; district admin with one numeric `board` → `district`; district admin without → redirect `BOARDS_PATH`; anyone else → redirect `/admin` |
| `src/admin/SchoolPlane/school-data.ts`    | `boardById(req, id)` — the board read as the user; `label` "Site · Folder → Board"                                                                                                                    |
| `src/admin/SchoolPlane/NewPostView.tsx`   | district: board unreadable → `BOARDS_PATH`; "Back to announcement boards"; `#new-post-board` "On the board {label}"; `NewPostForm` with that one board (no choice shown)                              |
| `src/admin/Boards/BoardsListView.tsx`     | per board: its link, and "New announcement" — accessible name "New announcement on {site} · {folder} → {board}" (visually hidden tail)                                                                |

### Flow

`NewPostForm` creates the draft through REST as the user with `tenant` from the board, so
Payload's site question (multi-tenant `assign-tenant` modal) never opens; then the post's own form,
where the district publishes as usual.

### Tests

- `tests/unit/admin/school-plane.test.ts` — `newPostRoute`
- `tests/e2e/boards-view.spec.ts` — board → headline → the post's form on that board, draft, no site
  question; `/admin/new-post` with no board → the boards screen
- `tests/e2e/admin-planes-axe.spec.ts` — "post an announcement on a board", both themes

## 16. A school manager's school, and creating from a list (Jason, 2026-11-04)

A school manager sees their school named, never a tenant control, and gets a create button on the
two lists they work in. The district's admin is unchanged.

| File                                        | Holds                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/admin/SchoolPlane/school-plane.ts`     | `listTaskFor(collection)` (pure): `pages` → "Add a page" `/admin/new-page`, from `SCHOOL_TASKS`; else null (`posts` has its own screen, §17). `schoolNamesLabel(names)`                                                                                                                                             |
| `src/admin/SchoolPlane/school-data.ts`      | `schoolsOf(payload, user)` — the user's tenants by name; `listMySchools(req)` delegates to it                                                                                                                                                                                                                       |
| `src/admin/SchoolPlane/SchoolNameNav.tsx`   | `admin.components.beforeNavLinks`: school manager → `#nav-school` "Your school {name}"; else nothing                                                                                                                                                                                                                |
| `src/admin/SchoolPlane/YourSchoolField.tsx` | `users.yourSchool` (ui field, school manager only): `#your-school` "Your school {name}" on `/admin/account`                                                                                                                                                                                                         |
| `src/admin/SchoolPlane/ListTaskButton.tsx`  | `beforeListTable` on `pages` (`clientProps.collection`): school manager → `#list-task` linking to `listTaskFor`; else nothing                                                                                                                                                                                       |
| `src/collections/Tenants.ts`, `Users.ts`    | `admin.hidden` unless district admin — out of the manager's menu; read access unchanged                                                                                                                                                                                                                             |
| `src/collections/Users.ts`                  | `tenants` declared with the plugin's `tenantsArrayField` (`includeDefaultField: false` in `payload.config.ts`), schema unchanged; it, `roles`, `entraObjectId`, `autoApprove`, `isBreakGlass` and `lastLoginAt` share `notForSchoolManagers` (`admin.condition`): a manager sees email, name, password, Your school |

### Why a button and not Payload's Create New

`postsCreateAccess` / `pagesCreateAccess` need the incoming `tenant`; Payload's permission check
for Create New sends no data, so it is false for a school manager. The access functions are left
as they are; the list leads to the task screen instead.

### Tests

- `tests/unit/admin/school-plane.test.ts` — `listTaskFor`, `schoolNamesLabel`
- `tests/e2e/school-plane.spec.ts` — the menu names School A with no Tenants/Users; the account
  page shows "Your school" with no tenants or roles field; each list's button reaches its task;
  the district keeps Tenants, Users, Create New and no task button
- `tests/e2e/admin-planes-axe.spec.ts` — the manager's pages list, posts list and account, both themes

## 17. The announcements screen (Jason, 2026-11-04)

Finalsite's Posts module, at "News and announcements" (`/admin/collections/posts`), for both
planes: each site's folders, a folder's boards, a board's posts newest first, and "Create post" at
the top right. Payload's flat posts list is replaced (`views.list.Component`).

| File                                               | Holds                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/admin/Announcements/announcements.ts`         | pure: `boardFromQuery` (one numeric `board` or null), `boardHref` `…/posts?board=<id>`, `createPostHref` `…/posts?board=<id>&new=1`, `wantsNewPost` (`new=1`), `findBoard(tree, id)` → site/folder/board, `soleBoard(tree)`, `announcementStatus(doc, 'district' \| 'school')`                                       |
| `src/admin/Announcements/AnnouncementsView.tsx`    | reads tenants, folders, boards and the board's posts AS THE VIEWER (`overrideAccess: false`; posts `draft: true`, 25 a page, `page`); `boardTree`; selected = `?board` or the viewer's sole board; `#board-heading`, `#create-post`; `new=1` → `#new-post` with `NewPostForm` on that board (`boardById`) and Cancel |
| `src/admin/Announcements/Announcements.module.css` | tree beside the board ≥60rem, stacked below; Payload theme variables                                                                                                                                                                                                                                                 |
| `src/admin/SchoolPlane/NewPostView.tsx`            | `/admin/new-post[?board]` → `createPostHref(board)` or `/admin/collections/posts?new=1`                                                                                                                                                                                                                              |
| `src/admin/SchoolPlane/NewPostForm.tsx`            | `focusOnOpen` puts the cursor in the headline                                                                                                                                                                                                                                                                        |
| `src/admin/SchoolPlane/school-data.ts`             | `boardById(payload, user, id)`; `listMyBoards` removed                                                                                                                                                                                                                                                               |
| `src/admin/Boards/BoardsListView.tsx`              | "New announcement" → `createPostHref(board)`                                                                                                                                                                                                                                                                         |

### Rules

- The district sees every site, folders or not, and "Manage folders and boards"; a school manager
  sees only sites they have folders on, and lands on their board when they have exactly one.
- A board not in the viewer's tree (another school's, or removed) → "That board can't be opened":
  no posts, no Create post, no headline.
- Status words: district Published / Draft / Waiting for approval / Sent back; school On the
  website / Not sent yet / Sent for approval / Needs changes. A waiting change outranks published.

### Why the headline, not Payload's create form

Payload's create view checks create access with no `tenant`, which `postsCreateAccess` refuses a
school manager by design; and with `drafts.validate` it cannot autosave until the required `slug`
exists. The headline creates the draft on the board as the user, so the words autosave from the
first keystroke.

### Tests

- `tests/unit/admin/announcements.test.ts` — every pure function above
- `tests/e2e/announcements.spec.ts` — district: sites, board chosen (`aria-current`), the post's row
  and status, Create post focuses the headline, Cancel; school: their board in their words, no
  School B; School B's board by address opens nothing; two boards → "Choose a board" → Athletics →
  Scores → the post is filed there
- `tests/e2e/boards-view.spec.ts`, `school-plane.spec.ts` — the boards screen and the school list
  lead here
- `tests/e2e/admin-planes-axe.spec.ts` — the screen with a board open and with none, district and
  school, both themes
- `tests/e2e/support/fixture-posts.ts` — fixtures file on School A's "News" by name

## 18. The district dashboard (Jason, 2026-11-04)

`04` §3.1, laid out as Jason chose: ① Approvals ② Needs freshening ③ Recent activity, then the
auto-approval panel, then Payload's cards under "Everything else". Sync status, live alerts and
the work queues join as their modules land.

| File                                        | Holds                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/dashboard.ts`                      | pure: `approvalSummary(waiting, now, tz)` (count, oldest via `describeWait`, overdue); `STALE_DAYS` 90; `staleSites(sites, last, now, tz)` (none published first, then oldest); `keyPageKind` (top-level `home`, `contact`, `calendar`); `staleKeyPages`; `CONTENT_ACTIONS`; `activityRow(event, now, tz)` |
| `src/admin/Dashboard/dashboard-data.ts`     | reads AS THE USER: `findWaiting`, `findSites`, `findLastPublished` (one windowed read per collection, then newest per quiet site), `findKeyPages`, `findRecentActivity` (content actions, newest 10)                                                                                                       |
| `src/admin/Dashboard/DistrictDashboard.tsx` | `beforeDashboard`, district only: `#district-dashboard` h1, `#approvals-panel`, `#freshness-panel`, `#activity-panel`; `EverythingElseHeading` `#everything-else`                                                                                                                                          |
| `src/lib/queue-age.ts`                      | `localDay`, `DAY` now exported                                                                                                                                                                                                                                                                             |
| `src/payload.config.ts`                     | `beforeDashboard`: `DistrictDashboard`, `GrantsPanel`, `EverythingElseHeading`                                                                                                                                                                                                                             |

`WaitingBanner.tsx` and `countWaiting` are removed: the Approvals panel replaces them.

### Rules

- "Published" = the main row with `_status: published`; its `updatedAt` is when it last went live.
- Stale = older than 90 days (exactly 90 is not). A site with nothing published is listed first.
- Activity: submit, request-changes, approve, auto-approve, publish, restore, delete. No sign-ins
  or account changes (Jason, 2026-11-04). A deleted item has no link.

### Tests

- `tests/unit/lib/dashboard.test.ts` — every pure function
- `tests/integration/dashboard.test.ts` — the reads in Postgres: top-level home only, drafts
  ignored, content actions only; a school manager sees their own site, no activity, no other
  site's last change
- `tests/e2e/district-dashboard.spec.ts` — panel order, a sent page counted and in the activity
  with its link, no sign-ins; `approval-queue.spec.ts` — the panel links to the queue;
  `admin-planes-axe.spec.ts` — the whole dashboard, both themes

## 19. Announcement dates: Start, Expires, Featured until (Jason, 2026-11-04)

District only. Set in the approval queue as an announcement is approved, or on the district's post
form. No end date. Expires = unpublished entirely.

| File                                                        | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/post-dates.ts`                                     | pure: `checkPostDates(input, now)` → `{ dates, schedules }` or per-field errors (past Start → null; Expires after go-live; Featured until future and ≤ Expires); `isFeatured`                                                                                                                                                                                                                                                        |
| `src/collections/Posts.ts`                                  | `publishAt`, `expiresAt`, `featuredUntil` (date, day + time, sidebar; read/create/update `districtOnlyField`; hidden from schools); `reviewState` option `scheduled`; `beforeChange: [postDatesHook, publishGate, …]`; endpoint `postScheduleEndpoint`                                                                                                                                                                               |
| `src/collections/hooks/scheduled-dates.ts`                  | `postDatesHook`: checks only CHANGED dates; publish + future Start on a never-live post → draft + `scheduled`, on a live post → ValidationError; republish clears a passed Expires. `SCHEDULED_RUN` / `scheduledRunOf(req)` — the job's `publish` / `expire` mark                                                                                                                                                                    |
| `src/access/review-state.ts`                                | state `scheduled`; district `requested: 'scheduled'` needs `schedules` (a future Start), not from `changes-requested`, keeps the submitter; a school's save drops it to `editing`                                                                                                                                                                                                                                                    |
| `src/access/posts.ts`                                       | `isPublishingWrite` counts a `publishAt`, as pages                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/collections/hooks/publish-gate.ts`                     | a Start counts only when the write CHANGES it (Payload merges the stored doc into every write); the job's `publish` mark passes                                                                                                                                                                                                                                                                                                      |
| `src/collections/hooks/review-state.ts`                     | passes `schedules`; job `publish` clears review fields, `expire` changes nothing                                                                                                                                                                                                                                                                                                                                                     |
| `src/collections/endpoints/approve.ts`                      | posts: body may carry the dates → `checkPostDates` (400 + `errors`); `approveDocument(…, dates)` — schedules → `draft: true` save with `reviewState: 'scheduled'`; else publish with the dates. `publishable` exported                                                                                                                                                                                                               |
| `src/collections/endpoints/schedule.ts`                     | `runSchedule(req, now)`: scheduled + Start ≤ now → publish the latest version if still `scheduled`; published + Expires ≤ now → `_status: draft`; Featured until passed in the last 10 min → `revalidatePost`. `POST /api/schedule/run` (root endpoint) (district, or `x-dd2-schedule-key` = HMAC of `PAYLOAD_SECRET`). `scheduleTask` every 5 min calls it on `DD2_INTERNAL_URL` or `127.0.0.1:$PORT`; on failure sweeps in-process |
| `src/collections/hooks/revalidate-on-publish.ts`            | `revalidatePost` (moved from `Posts.ts`, named for the job)                                                                                                                                                                                                                                                                                                                                                                          |
| `src/content/posts.ts`                                      | `listPosts`: featured (`featuredUntil > now`) first, then the rest; each newest first                                                                                                                                                                                                                                                                                                                                                |
| `src/admin/Approvals/ApprovalDates.tsx`, `ApprovalItem.tsx` | posts: "Set dates (optional)" `<details>`, three `datetime-local` inputs; checked client-side with `checkPostDates`; a future Start makes "Approve and schedule"; outcome "Approved. … goes live on …"                                                                                                                                                                                                                               |
| `src/lib/audit.ts`, `src/lib/dashboard.ts`                  | actions `schedule` ("Goes live …") and `expire`; the job's publish summary "At its scheduled time"; activity sentences                                                                                                                                                                                                                                                                                                               |
| `src/lib/review-emails.ts`                                  | outcome `scheduled` (approved, goes live on …); `scheduled` → published = `approved`                                                                                                                                                                                                                                                                                                                                                 |
| `src/admin/Announcements/announcements.ts`, `SchoolPlane/*` | `scheduled`: district "Scheduled", school "Approved, goes live later"; school recent submissions include it (posts only)                                                                                                                                                                                                                                                                                                             |

### Why an endpoint for the job

`revalidatePath` works only in Route Handlers and Server Functions; a job outside a request cannot
refresh the public pages, which otherwise revalidate hourly. The task calls the endpoint so the
sweep runs inside a request.

### Tests

- `tests/unit/lib/post-dates.test.ts`; `review-state.test.ts`, `posts.test.ts`, `publish-gate.test.ts`
  (a changed vs carried Start); `audit.test.ts`, `dashboard.test.ts`, `review-emails.test.ts`,
  `announcements.test.ts`, `school-plane.test.ts`
- `tests/integration/schedule.test.ts` — approve-for-later stays off the site and leaves the
  queue; goes live only at its time; a school's edit after approval is not published by waiting;
  schools cannot set or read the dates; the district form schedules a new post and refuses a Start
  on a live one; Expires unpublishes and is audited; republishing clears a passed Expires
- `tests/integration/content-layer.test.ts` — featured first, then back in date order
- `tests/e2e/post-dates.spec.ts` — "Approve and schedule"; a wrong date beside its field + axe,
  both themes; the district form has the dates, a school's has none; the endpoint refuses others

## 20. A page's Start, acted on (Jason, 2026-11-04)

Pages had a `publishAt` in Page settings that nothing acted on. It now works the way an
announcement's Start does (§19).

| File                                       | Holds                                                                                                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/collections/hooks/scheduled-dates.ts` | `makeDatesHook(fields, noun)`; `postDatesHook` (three dates), `pageDatesHook` (Start only)                                                                                                                                              |
| `src/collections/Pages.ts`                 | `beforeChange: [pageDatesHook, publishGate, …]`; `publishAt` labelled Start, day + time, read/create/update district-only, hidden from schools; `reviewState` option `scheduled`; `beforeDuplicate` → null on `reviewState` (posts too) |
| `src/collections/endpoints/schedule.ts`    | `runSchedule` publishes scheduled pages and posts (results as `collection/id`); expiry and featured stay posts-only. `scheduleEndpoint` is a ROOT endpoint: `POST /api/schedule/run`; task slug `publishSchedule`                       |
| `src/lib/review-emails.ts`                 | `scheduled` email per noun: a page's reads "your changes … They go live on …"                                                                                                                                                           |
| `src/admin/SchoolPlane/school-data.ts`     | recent submissions include `scheduled` for pages and posts                                                                                                                                                                              |

Rules as §19: publishing with a Start to come schedules a page that is not live; a live page with a
new Start is refused; a school's edit drops the schedule; a clone is never scheduled.

### Tests

- `tests/integration/schedule.test.ts` — a page published with a Start to come stays a draft and goes
  live at its time; a school can still edit it and cannot read the Start, and its edit is not
  published; a Start on a live page is refused
- `tests/integration/page-clone.test.ts` — a clone of a scheduled page is not scheduled
- `tests/unit/lib/review-emails.test.ts` — the page wording
- `tests/e2e/post-dates.spec.ts` — Start in Page settings; none on a school's page form;
  `review-state-fields.spec.ts` counts four states

## 21. Two page types, and Columns (Jason, 2026-11-04)

Page types are `standard` ("Page", school-editable words) and `composed` (district blocks). The
five fixed types are gone. Data arrives as components the district places: Columns now; Calendar
and Directory with their modules; Shared content (COPE) next.

| File                                                            | Holds                                                                                                                                                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/content/types.ts`                                          | `PageType = 'standard' \| 'composed'`; `FIXED_PAGE_TYPES = ['standard']`; `ColumnsBlock` / `ResolvedColumnsBlock`; `ResolvedPageBlock` excludes the stored `ColumnsBlock`                       |
| `src/collections/Pages.ts`                                      | `pageType` options Page / Composed (district only)                                                                                                                                              |
| `scripts/collapse-page-types.sql`                               | one-off: old types → `standard` on `pages` and `_pages_v`. Plain SQL — run with `psql` BEFORE Payload starts, which pushes the narrowed enum                                                    |
| `src/admin/SchoolPlane/school-plane.ts`, `NewPageForm.tsx`      | no kind question: `checkNewPage` is title + school; the form creates `pageType: 'standard'`                                                                                                     |
| `src/lib/dashboard.ts`, `src/admin/Dashboard/dashboard-data.ts` | key page = each site's top-level `home` only                                                                                                                                                    |
| `src/admin/Approvals/page-diff.ts`                              | type labels Page / Composed                                                                                                                                                                     |
| `src/collections/blocks/index.ts`                               | `columnsBlock`: optional `heading`; `columns` array 2–3 of { optional `heading`, `content`: blocks = the library minus columns }. Nested rows live in the same `pages_blocks_*` tables, by path |
| `src/content/blocks.ts`                                         | `toColumns`: ≤3 columns, each `toPageBlocks(content)` without columns; an empty column kept; all empty → dropped                                                                                |
| `src/content/resolve-blocks.ts`                                 | `columns`: each column's blocks resolved recursively (a feed in a column fills)                                                                                                                 |
| `src/blocks/Columns/levels.ts`                                  | `columnLevels(base, { blockHeading, columnHeading })` → block / column / content levels, clamped at h6                                                                                          |
| `src/blocks/Columns/Columns.tsx`, `.module.css`, `.stories.tsx` | grid: 1 column; ≥48rem 2 across; ≥64rem 3 across for three; `renderBlocks` prop = `BlockList` (no circular import)                                                                              |
| `src/blocks/BlockList.tsx`                                      | `case 'columns'` → `Columns` with `renderBlocks={(blocks, level) => <BlockList …/>}`                                                                                                            |

### Tests

- `tests/unit/blocks.test.ts` — columns mapping; `tests/unit/components/columns-levels.test.ts`
- `tests/unit/admin/school-plane.test.ts`, `tests/unit/lib/dashboard.test.ts`, `page-diff`,
  `pages`, `publish-gate` — the two types
- `tests/integration/content-layer.test.ts` — a feed inside a column resolves;
  `tests/integration/dashboard.test.ts` — the front page is the key page
- `tests/e2e/columns.spec.ts` — h2 / h3 per column / h4 inside; side by side at 1280, stacked in
  reading order at 375 with no sideways scroll; axe. `admin-planes-axe` — the page form with
  columns, both themes. `school-plane`, `phase-4-exit` — Add a page asks no kind
- Storybook `Blocks/Columns` — four stories through `BlockList`, the component gate LTR + RTL

## 22. Schools compose with the simple components (Jason, 2026-11-04 — "level B")

A school manager edits, adds, removes and reorders the SIMPLE components — Text, Button, Cards,
Accordion, Divider — on their own school's pages, around the district's components, and sends the
change for approval. The district's components (Columns, News feed, Embed, Section menu, and any
block added later until it is named) stay exactly as the district set them. Inside the district's
Columns the same rules apply again: a school writes in a column; the columns themselves do not
change. Converting every page to composed is the next PR.

| File                                    | Holds                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/access/school-layout.ts`           | PURE. `SCHOOL_BLOCKS`; `checkSchoolLayout(stored, incoming)` → `{ ok }` or `{ ok: false, reason }` — the district's components, by `id`, same order, unchanged (`sameComponent`, key-order and null-insensitive); Columns: frame unchanged, each column's `content` recursively. Unknown block = district's. `schoolPalette(current)` = simple + kinds already present |
| `src/collections/hooks/publish-gate.ts` | `schoolLayoutGate` (replaces `composedPagesAreDistrictOnly`): no user → trusted server code, passes; district → passes; school manager → `checkSchoolLayout(originalDoc.layout, data.layout ?? originalDoc.layout)`, refusal = `ValidationError` on `layout` with the reason; any other user → `Forbidden` if it sends a non-empty `layout`                            |
| `src/access/pages.ts`                   | the `isComposedWrite` check gone from create and update access; `canComposePages` (district) now means "may place any component"                                                                                                                                                                                                                                       |
| `src/collections/Pages.ts`              | `beforeChange: [pageDatesHook, publishGate, schoolLayoutGate, applyReviewState]`; `layout` field access `composesField` (district or school manager); `filterOptions` → `schoolPalette(siblingData.layout)` for a user who `sendsForApproval`                                                                                                                          |
| `src/collections/blocks/index.ts`       | `columnsBlock.columns[].content` `filterOptions` → `schoolPalette(siblingData.content)` for the same users                                                                                                                                                                                                                                                             |
| `src/admin/Approvals/page-diff.ts`      | `diffLayout(live, proposed)` → `{ changes: SectionChange[], unchanged }`; a change is added / removed / changed / moved, with `kind` (form words), `summary` (shortened), `where` ("In column 2 of …"), and line `words` for changed Text. Moved = outside the longest run kept in order. `diffPage` sets `sections` when any changed                                  |
| `src/admin/Approvals/PageDiffView.tsx`  | "Changes to the sections of the page (N sections unchanged)": one line per change, e.g. "Added Text: …"                                                                                                                                                                                                                                                                |

Why `filterOptions` includes the kinds already present: Payload refuses to save a block its picker
does not allow, so without them a school could not save a page that carries a news feed. Offering
the kind does not let a school add one — the hook refuses that.

### Tests

- `tests/unit/access/school-layout.test.ts` — add / edit / remove / reorder simple components
  pass; adding, removing, editing or moving a district component is refused; Columns frame vs
  column contents; unknown block types deny; `schoolPalette`
- `tests/unit/access/publish-gate.test.ts`, `tests/unit/access/pages.test.ts` — the gate per role;
  composed writes no longer refused by access
- `tests/unit/admin/layout-diff.test.ts` — `diffLayout`: added, removed, changed Text as lines,
  changed other, one moved section only, changes inside columns, shortening, malformed input
- `tests/integration/tenant-isolation.test.ts` — over the real API: a school creates a composed page
  from simple components; cannot place a news feed, columns or an embed; cannot remove or change
  the district's component on its own page; still cannot compose another school's page
- `tests/e2e/school-composition.spec.ts` — a school's picker offers Text and not Columns / Video /
  Section menu; adds a Text section and sends it; the stored draft is `submitted` with
  `richText, feed, richText`; the page form axe, both themes; the queue reads "Added Text: …" and
  "(2 sections unchanged)". `tests/e2e/support/fixture-pages.ts` `deletePage` releases Payload's
  document lock (`payload-locked-documents`) before deleting, since an open edit form leaves one

## 23. Every page composed — the expand step (Jason, 2026-11-04)

**Superseded by §24:** the contract step deleted every file below that exists only for the switch.

A page's words are a Text section now, on every page. This is the EXPAND half of retiring `body`
and the `standard` page type: nothing new is written to either, existing pages are converted
once, and the renderer still reads both. The CONTRACT half — dropping the `body` column and the
`standard` value — is a later PR, after `compose:pages` has run on every database.

| File                                     | Holds                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/compose-page.ts`                | PURE. `hasWords(body)` — any non-blank text, or a placed leaf (not a line break); `composeBody(body, layout)` → `{ changed, layout }`: a Text section (`richText`, no id) holding the body, ON TOP of the sections; no words → unchanged                                                                    |
| `src/collections/hooks/compose-body.ts`  | `composeBodyOnWrite`, FIRST `beforeValidate` on pages: words sent in `body`, else the stored ones, become a Text section on top of the sections sent (else stored); `body` → null; `pageType` → `composed` on every write. `body: null` sent = emptied, nothing moves. Catches restores, clones, API writes |
| `src/lib/compose-existing-pages.ts`      | `composeExistingPages(payload, { ids? })` → `{ converted }`. Lists the MAIN table (a versions `find` reads `id` as the version's). Per page: live and needing it → republished converted; then a newer draft (waiting, or never published) → written again converted, on top. A converted page is skipped   |
|                                          | `COMPOSING_PAGES` / `composingPagesOf(req)`: the mark on those writes (no user). `publishGate` lets a marked user-less publish through; `applyReviewState` keeps the review fields the write carries; `notify-review-outcome` sends nothing. Audit records them as System                                   |
| `scripts/compose-pages.ts`               | `pnpm run compose:pages` — runs it over every page; logs the ids                                                                                                                                                                                                                                            |
| `src/collections/Pages.ts`               | `body` and `pageType` `admin.hidden`; `pageType` default `composed`; `layout` shown on every page (no condition), labelled "Add Section"; Columns' `content` too                                                                                                                                            |
| `src/admin/SchoolPlane/NewPageForm.tsx`  | creates `pageType: 'composed'`, no sections (an empty Text would fail its required Words)                                                                                                                                                                                                                   |
| `src/admin/PageToolbar/page-settings.ts` | `pageType` out of the settings                                                                                                                                                                                                                                                                              |
| `src/admin/Approvals/page-diff.ts`       | no "Page type" row                                                                                                                                                                                                                                                                                          |
| `src/lib/seo.ts`                         | description fallback: SEO description → `body`'s first paragraph → the first TOP-LEVEL Text section's first paragraph → the site's                                                                                                                                                                          |
| `scripts/seed.ts`                        | seeded pages are one Text section, `body: null` sent (so an unconverted database does not get the words twice)                                                                                                                                                                                              |

Order on an existing database: `pnpm run compose:pages`, then anything else (seed, deploy).

### Tests

- `tests/unit/lib/compose-page.test.ts` — on top, ids and order kept, empty bodies, headings,
  malformed layout
- `tests/unit/access/compose-body-hook.test.ts` — sent words, stored words, sent layout wins,
  emptied body, converted page untouched
- `tests/unit/access/publish-gate.test.ts` — the mark: user-less passes, unmarked refused, a school
  manager with the mark refused
- `tests/unit/seo.test.ts` — the first Text section; `body` first; not inside columns
- `tests/unit/admin/page-diff.test.ts` — no page-type row
- `tests/integration/compose-existing-pages.test.ts` — over real drafts and versions, legacy rows
  written through `payload.db` under the hooks: live stays live; a school's waiting change keeps
  its words, state and submitter and emails nobody; never-published stays a draft; words above
  existing sections; no words → only the type; a second run changes nothing
- `tests/integration/content-layer.test.ts` — page links and reuse rehoming read from the Text
  section
- e2e — `support/fixture-pages.ts` `wordsSection()`; fixture, toolbar and linked pages carry one;
  `paste-normalizer.spec.ts` adds a Text section to a new page before pasting

## 24. Every page composed — the contract step (Jason, 2026-11-04)

Pages have no `body` and no `pageType`. A page is its `layout`: its words are Text sections among
its components. Announcements keep their `body`. §23's switch is gone: `compose-page.ts`,
`compose-existing-pages.ts`, `composeBodyOnWrite`, `scripts/compose-pages.ts` and the
`composingPages` mark in `publishGate`, `applyReviewState` and `notify-review-outcome`.

| File                                                                    | Holds                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/retire-page-body.sql`                                          | one-off, plain SQL, idempotent: drops `pages.body`, `pages.page_type`, `_pages_v.version_body`, `_pages_v.version_page_type`, their indexes and enum types. Run BEFORE Payload starts |
| `src/collections/Pages.ts`                                              | no `body`, no `pageType` field; `beforeValidate: [deriveSlugFromTitle, uniqueSlugWithinParent, rootPageCannotBeParent]`                                                               |
| `src/content/types.ts`, `src/content/pages.ts`, `src/content/index.ts`  | `Page` has no `body` / `pageType`; `PageType` gone; the mapper reads `layout` only (rehomed for reuse)                                                                                |
| `src/app/(frontend)/sites/[hostname]/[locale]/[[...segments]]/page.tsx` | title, then `BlockList` — no `RichText` body                                                                                                                                          |
| `src/lib/seo.ts`                                                        | `PageMetadataInput.page.body` optional (an announcement's); description: SEO → body (announcements) → first top-level Text section → the site's                                       |
| `src/admin/Approvals/page-diff.ts`                                      | `diffPage`: fields + sections; its `body` is always null. The block-by-block body diff is `diffPost`'s                                                                                |
| `src/access/auto-approval.ts`                                           | pages `neverFields`: `layout`, `parent`, `visibility`, `meta`                                                                                                                         |
| `src/access/pages.ts`                                                   | `IncomingData` without `pageType`                                                                                                                                                     |

Lost on purpose: the words of page VERSIONS saved before §23, which only lived in
`version_body`. A restore of one brings back its title, settings and sections, not those words.

### Tests

- `tests/unit/access/pages.test.ts` — create / update access without a page type
- `tests/unit/admin/page-diff.test.ts` — a page diff has no body; the block-by-block tests are
  `diffPost`'s
- `tests/unit/seo.test.ts` — a page describes itself from its first Text section
- `tests/integration/content-layer.test.ts` — page links and reuse rehoming inside a Text section
- e2e — `linked-pages.spec.ts` reuses a district page whose words are a Text section

## 25. Live Preview (Jason, 2026-11-10)

The page as it will look, beside its form, following the editor's typing on each autosave.
Payload's built-in Live Preview panel frames a DD2 route; the route reads the draft as the person
signed in. Chosen over a drag-and-drop canvas after Puck failed axe and keyboard use (spike,
2026-11-10).

| File                                                  | Holds                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/collections/Pages.ts`                            | `admin.livePreview`: `url` → `/admin-preview/pages/<id>` (null until saved); breakpoints Phone 375×667, Tablet 768×1024, Desktop 1280×800                                                                                                                                                 |
| `src/content/preview.ts`                              | `getPreviewer(headers)` → opaque `Previewer` (`payload.auth` on the session cookie) or null; `getPagePreview(id, previewer)` → `{ hostname, title, layout }` from `findByID(draft: true, depth: 1, user, overrideAccess: false)`, or null (no user, non-numeric id, no access, no tenant) |
| `src/app/(preview)/admin-preview/layout.tsx`          | own root layout: `lang="en"`, `dir="ltr"`, skip link, `globals.css`; metadata title "Page preview", robots noindex/nofollow                                                                                                                                                               |
| `src/app/(preview)/admin-preview/pages/[id]/page.tsx` | `force-dynamic`. previewer → preview → `resolveSite({ hostname, locale: 'en' })` → `getTheme` tokens on a wrapper → `resolvePageBlocks` → `SiteFrame` + title `h1` + `BlockList`; anything missing → `notFound()`                                                                         |
| `src/admin/LivePreview/RefreshOnSave.tsx`             | client: Payload's `RefreshRouteOnSave` → `router.refresh()` on every save message. The one Payload import the preview needs, on the admin side                                                                                                                                            |
| `eslint.config.mjs`                                   | the content boundary covers `src/app/(preview)/**`                                                                                                                                                                                                                                        |
| `src/admin/A11yPatch/repairs.ts`, `A11yPatch.tsx`     | `#live-preview-iframe` title "Page preview"; size inputs "Preview width"/"Preview height"; `button.live-preview-toggler` `aria-pressed` FOLLOWS its `--active` class. The observer also watches `class` attributes (never ones the repairs set)                                           |

`/admin-preview` stays on the admin host: the proxy's general matcher skips paths starting
`admin`, so the session cookie reaches it. Package: `@payloadcms/live-preview-react` 3.87.0,
pinned with Payload.

### Tests

- `tests/integration/page-preview.test.ts` — the draft, not the live version; a manager's own
  school; another school's page → null; nobody → null; unknown or malformed id → null
- `tests/unit/admin/a11y-patch.test.ts` — frame title, size labels, toggle state both ways
- `tests/unit/proxy.test.ts` — `/admin-preview/…` is not matched; `/about/admin-preview` is
- `tests/e2e/live-preview.spec.ts` — a school manager opens it by keyboard (`aria-pressed`), sees
  the page in School A's header with its words, types and sees the preview follow; whole-screen
  axe with it open, both themes; another school's preview and no sign-in → 404, the district → 200
