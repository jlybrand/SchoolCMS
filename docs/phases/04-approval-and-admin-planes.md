# Phase 4 — Approval workflow and the two admin planes

How a school's change reaches the public: the review state on `pages`, who may move it, and
(as later slices land) the school plane's one button, the district queue, auto-approval
grants, notifications and audit.

Phase 4 lands across several PRs. This document is written as each one merges.

| Slice                                          | State                |
| ---------------------------------------------- | -------------------- |
| Review state on `pages`                        | Merged (#26) — §1–§5 |
| School plane: "Send for approval" on a page    | Merged (#27) — §6–§7 |
| School plane: task view, constrained new page  | Merged (#28) — §8    |
| District queue: inline diff, one-click approve | Merged (#29) — §9    |
| The Publish slot on a waiting page             | Merged (#30) — §10   |
| Submitter email on approve / request changes   | Merged (#31) — §11   |
| District digest and overdue alert              | Merged (#33) — §12   |
| Auto-approval grants (zero issued)             | Merged (#35) — §13   |
| Page history is district-only                  | **This PR** — §14    |
| Audit trail                                    | —                    |

---

## 1. File inventory — review state

### Added

| File                                          | Holds                                                         |
| --------------------------------------------- | ------------------------------------------------------------- |
| `src/access/review-state.ts`                  | `resolveReview` (pure), `ReviewState`, `ReviewFields`         |
| `src/collections/hooks/review-state.ts`       | `applyReviewState` — the `beforeChange` adapter               |
| `tests/unit/access/review-state.test.ts`      | The transition table, role by state                           |
| `tests/unit/access/review-state-hook.test.ts` | The adapter: fields written, ids, which error each refusal is |
| `tests/integration/review-workflow.test.ts`   | The loop against real Payload, drafts beside a live page      |
| `tests/e2e/review-state-fields.spec.ts`       | The field read-only, axe in both Payload themes               |
| `tests/e2e/page-autosave.spec.ts`             | A changed field saves itself and stays off the live page      |

### Changed

| File                       | Change                                                 |
| -------------------------- | ------------------------------------------------------ |
| `src/collections/Pages.ts` | Four fields; `applyReviewState` last in `beforeChange` |
| `src/payload-types.ts`     | Regenerated                                            |

## 2. The fields

| Field         | Type                    | Admin                                           |
| ------------- | ----------------------- | ----------------------------------------------- |
| `reviewState` | `radio`, indexed        | Read-only, sidebar                              |
| `reviewNote`  | `textarea`              | Read-only, sidebar, only on `changes-requested` |
| `submittedAt` | `date`, indexed         | Hidden                                          |
| `submittedBy` | relationship -> `users` | Hidden                                          |

`reviewState` values: `null` (nothing pending), `editing`, `submitted`, `changes-requested`. No
default. All four live on the draft and on each version.

## 3. Transitions

`resolveReview({ user, current, requested, note, publishing, now })` -> `{ ok, fields }` or
`{ ok: false, reason, field? }`. "Asked" means `requested` is defined and differs from the stored
state.

| Actor          | Write                                | From                                 | Result                                                               |
| -------------- | ------------------------------------ | ------------------------------------ | -------------------------------------------------------------------- |
| school-manager | `reviewState: 'submitted'`           | null, `editing`, `changes-requested` | `submitted`; note cleared; `submittedAt = now`; `submittedBy = user` |
| school-manager | any save                             | `submitted`                          | unchanged (age kept)                                                 |
| school-manager | any save                             | `changes-requested`                  | unchanged (note kept)                                                |
| school-manager | any save                             | null, `editing`                      | `editing`                                                            |
| school-manager | asks `changes-requested` or null     | any                                  | refused -> `Forbidden`                                               |
| school-manager | publishing                           | any                                  | refused (the publish gate refuses first)                             |
| district-admin | publishing                           | any                                  | all four cleared                                                     |
| district-admin | asks `changes-requested` with a note | `submitted`                          | `changes-requested`; note trimmed; submitter kept                    |
| district-admin | asks `changes-requested`, empty note | `submitted`                          | refused -> `ValidationError` on `reviewNote`                         |
| district-admin | asks `changes-requested`             | anything else                        | refused -> `Forbidden`                                               |
| district-admin | asks anything else                   | any                                  | refused -> `Forbidden`                                               |
| district-admin | a draft save, not asking             | any                                  | unchanged                                                            |
| system-sync    | anything                             | any                                  | refused -> `Forbidden`                                               |
| no user        | anything (access overridden)         | any                                  | unchanged                                                            |

A stored value outside the three reads as null.

## 4. The write path

```
payload.update / create (any route)
  -> pagesUpdateAccess / pagesCreateAccess      refuses a publishing write by a non-district user
  -> beforeValidate: slug hooks
  -> beforeChange:
       publishGate                              throws Forbidden on publish by a non-district user
       composedPagesAreDistrictOnly
       applyReviewState                         resolveReview over (originalDoc, data); replaces all four fields
```

`data` in `beforeChange` already has the stored document merged in, so a value the request did
not send arrives equal to the stored one. That is why a save on a `submitted` page cannot be told
apart from a resend, and both keep it queued.

`submittedBy` is compared as a string inside `resolveReview` and written back as the user's own id
(a number under Postgres) by `storableSubmitter`.

### Not here yet

- Approve through the queue publishes **the version the reviewer saw** (§9). On a waiting page the
  page form offers no Publish (§10); a publishing write through the API is not version-checked.
- The district's actions (approve, request changes) have no UI yet; the school's button is §6.
- A brand-new page does not autosave before its first save (§5).

## 5. Autosave

`versions.drafts`: `{ autosave: true, validate: true }`.

| Situation                        | What happens                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Existing page, a field changes   | `PATCH /api/pages/:id?autosave=true&draft=true` after the debounce (800 ms)       |
| New page, before its first save  | Nothing autosaves; the form shows "Save draft"                                    |
| New page, after its first save   | As an existing page                                                               |
| Any autosave                     | Goes through `publishGate` and `applyReviewState`; never publishes or moves state |
| A draft missing a required field | Refused — `validate: true` applies required fields to drafts                      |

Without `validate: true`, Payload's create view calls `payload.create` on open and redirects to the
new id, leaving an untitled draft for every abandoned "new page".

`tests/e2e/page-autosave.spec.ts` retypes if no autosave lands within 4 s: Payload's `Autosave`
ignores the form state present when it mounts, so an edit made before mount is not saved.

## 6. Send for approval — the school manager's page form

### Files

| File                                                  | Holds                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `src/admin/SendForApproval/review-status.ts`          | `sendsForApproval(user)`, `describeReview(fields, timeZone)`  |
| `src/admin/SendForApproval/SendForApprovalButton.tsx` | `PublishButton` slot                                          |
| `src/admin/SendForApproval/SchoolSaveDraftButton.tsx` | `SaveDraftButton` slot                                        |
| `src/admin/SendForApproval/ReviewStatusField.tsx`     | The `reviewStatus` ui field's component                       |
| `src/admin/SendForApproval/send-for-approval.css`     | Hides Payload's `.status` when the school's button is present |
| `tests/unit/admin/send-for-approval.test.ts`          | Who gets the button; the status wording                       |
| `tests/e2e/send-for-approval.spec.ts`                 | The flow, both roles; axe in both themes                      |
| `tests/e2e/support/school-session.ts`                 | Creates the School A manager per run; `schoolTest`            |

Changed: `src/collections/Pages.ts` (two edit slots, `reviewStatus` ui field first),
`tests/e2e/admin-session.setup.ts` (also signs in the school manager),
`src/app/(payload)/admin/importMap.js` (regenerated), `package.json` (`@payloadcms/ui` 3.87.0,
exact).

### Who sees what

`sendsForApproval(user)` = has `school-manager` and not `district-admin`.

| Element in the page form          | `sendsForApproval` true                           | false                       |
| --------------------------------- | ------------------------------------------------- | --------------------------- |
| `PublishButton` slot              | "Send for approval" (`#action-send-for-approval`) | Payload's `PublishButton`   |
| `SaveDraftButton` slot (new page) | nothing                                           | Payload's `SaveDraftButton` |
| `reviewStatus` ui field           | shown, first in the form                          | condition false — absent    |
| Payload `.status` in the header   | `display: none`                                   | shown                       |

### The button

```
click
  -> useForm().submit  (client validation ON)
       POST   /api/pages?draft=true...        (new page)
       PATCH  /api/pages/:id?draft=true...    (existing)
       body: form data + { _status: 'draft', reviewState: 'submitted' }
  -> the write path in §4; applyReviewState decides the outcome
  -> Payload resets the form from the response -> reviewStatus re-renders
```

Never disabled: sending an unmodified page (already autosaved) is the normal case. A second press
on a `submitted` page keeps it `submitted` (§3).

### Status wording — `describeReview`

| `reviewState`          | Heading                         | Also                                                       |
| ---------------------- | ------------------------------- | ---------------------------------------------------------- |
| null, `editing`, other | Your changes save automatically | When you are ready, send them for approval.                |
| `submitted`            | Sent for approval on {Month D}  | Date in `America/New_York`; no date -> "Sent for approval" |
| `changes-requested`    | The district asked for changes  | The trimmed note, if any; "send it for approval again"     |

### Known gaps

- Payload's "more options" (⋯) button in the header has no accessible name (axe `button-name`,
  critical) for every role. The spec's axe check is scoped to `#action-send-for-approval` and
  `#review-status`, so it does not cover that button.
- The read-only `reviewState` / `reviewNote` sidebar fields still show for school managers,
  beside the status field.
- A school manager's new page is created by sending it; nothing autosaves before that (§5).

## 7. A school manager must have a school

`missingSchool(data, originalDoc)` in `src/access/user-school.ts`, run as a `beforeValidate` hook
on `users` (after the password check). Throws `ValidationError` on path `tenants` with
`NEEDS_SCHOOL`.

| Write                                                  | Result                         |
| ------------------------------------------------------ | ------------------------------ |
| roles include `school-manager`, no non-empty `tenant`  | refused                        |
| a field not sent is read from the stored document      | —                              |
| `district-admin` / `system-sync` / no roles, no school | allowed                        |
| any save on a manager STORED without a school          | refused until a school is sent |

Tests: `tests/unit/access/user-school.test.ts`, `tests/integration/user-school.test.ts`.

The isolation fixture `noTenantManager` (`tests/helpers/payload.ts`) is created with a school and
its `users_tenants` row deleted in SQL, so the access functions are still proven to fail closed on
a schoolless manager that predates the rule.

## 8. The school plane's home screen and tasks

### Files

| File                                       | Holds                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `src/admin/SchoolPlane/school-plane.ts`    | `SCHOOL_TASKS`, `SCHOOL_PAGE_TYPES`, `checkNewPage`, `explainCreateError`, `submissionStatus` |
| `src/admin/SchoolPlane/school-data.ts`     | `listSchoolPages`, `listMySubmissions`, `listMySchools` (server reads)                        |
| `src/admin/SchoolPlane/SchoolHome.tsx`     | `views.dashboard`                                                                             |
| `src/admin/SchoolPlane/UpdatePageView.tsx` | `views.updatePage` at `/admin/update-page`                                                    |
| `src/admin/SchoolPlane/NewPageView.tsx`    | `views.newPage` at `/admin/new-page`; renders `NewPageForm`                                   |
| `src/admin/SchoolPlane/NewPageForm.tsx`    | The client form                                                                               |
| `tests/unit/admin/school-plane.test.ts`    | The pure decisions                                                                            |
| `tests/e2e/school-plane.spec.ts`           | The flows, both roles; axe on each view in both themes                                        |
| `tests/e2e/support/fixture-pages.ts`       | Throwaway pages + the axe helper, shared with `send-for-approval.spec.ts`                     |

Registered in `src/payload.config.ts` under `admin.components.views`.

### Routing by role

| Route                | `sendsForApproval` true       | false                        |
| -------------------- | ----------------------------- | ---------------------------- |
| `/admin`             | `SchoolHome` (`#school-home`) | Payload's `DefaultDashboard` |
| `/admin/update-page` | page list (`#update-page`)    | `redirect('/admin')`         |
| `/admin/new-page`    | new-page form (`#new-page`)   | `redirect('/admin')`         |

### Reads

All `payload.find` on `pages` run as the user (`overrideAccess: false`, `draft: true`), so the
access functions are the only tenant filter.

| Function            | Query                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `listSchoolPages`   | every readable page, by title, limit 200                                                         |
| `listMySubmissions` | `submittedBy = user` and `reviewState in (submitted, changes-requested)`, newest first, limit 20 |
| `listMySchools`     | the user's tenant ids -> names (`overrideAccess: true`, ids from the user)                       |

### Create

```
NewPageForm submit
  -> checkNewPage({ title, pageType, school, schools })   errors -> shown beside fields, focus first
  -> POST /api/pages?draft=true  { title, pageType, tenant, _status: 'draft' }
       slug derived by deriveSlugFromTitle; reviewState -> editing (applyReviewState)
  -> 2xx: router.push(/admin/collections/pages/:id)
  -> else: explainCreateError(body) in a role="alert" paragraph, focused
```

A school with one assignment is never asked for; with several, a radio group asks.

### Not here yet

- Tasks for posts, events, documents and photos join `SCHOOL_TASKS` with their modules (Phases 5–6).
- "Your recent submissions" lists only pending items; _Published_ needs the audit trail.
- Payload's own navigation (Pages, Users) still shows to school managers.
- The slug field stays editable on the page form for school managers.
- `uniqueSlugWithinParent` reads the `pages` table, so a slug changed by a later DRAFT save is not
  checked against siblings until it is published.

## 9. The district approval queue

### Files

| File                                             | Holds                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `src/access/approval.ts`                         | `checkApproval`, `VersionToken` (pure)                                    |
| `src/collections/endpoints/approve-page.ts`      | `approvePage`, `latestVersion`, `approvePageEndpoint`, `APPROVE_MESSAGES` |
| `src/collections/hooks/revalidate-on-publish.ts` | `makeRevalidateOnPublish`, `tenantSitePath`, `tenantHostname`             |
| `src/admin/Approvals/page-diff.ts`               | `diffPage` (pure)                                                         |
| `src/lib/queue-age.ts`                           | `describeWait`, `businessDaysBetween`, `OVERDUE_BUSINESS_DAYS = 3`        |
| `src/admin/Approvals/request-changes.ts`         | `checkNote` (pure)                                                        |
| `src/admin/Approvals/queue-data.ts`              | `loadQueue`, `countWaiting`                                               |
| `src/admin/Approvals/ApprovalsView.tsx`          | `views.approvals` at `/admin/approvals`                                   |
| `src/admin/Approvals/ApprovalItem.tsx`           | One item: diff, approve, request changes                                  |
| `src/admin/Approvals/PageDiffView.tsx`           | Renders a `PageDiff`                                                      |
| `src/admin/Approvals/WaitingBanner.tsx`          | `beforeDashboard` — count + link, district only                           |
| `src/admin/Approvals/ApprovalsNavLink.tsx`       | `afterNavLinks` — "Approvals", district only                              |

Tests: `tests/unit/access/approval.test.ts`, `tests/unit/admin/{page-diff,request-changes}.test.ts`, `tests/unit/lib/queue-age.test.ts`,
`tests/unit/access/revalidate-on-publish.test.ts`, `tests/integration/approve-page.test.ts`,
`tests/e2e/approval-queue.spec.ts`.

Changed: `src/collections/Pages.ts` (`afterChange`, `endpoints`), `src/payload.config.ts` (view,
`beforeDashboard`, `afterNavLinks`), `src/admin/SchoolPlane/NewPageForm.tsx` (focus in an effect).

### Load

```
ApprovalsView (district only; else redirect /admin)
  -> loadQueue(req)
       find pages  reviewState = submitted, draft: true, sort submittedAt, limit 50, as the user
       per page:  latestVersion()            findVersions parent = id, sort -updatedAt, limit 1
                  findByID draft: false      the main row; live iff _status = published
                                             (disableErrors: a page deleted mid-load is skipped)
       names:     tenants, users (submittedBy), parent pages — one find each
  -> QueueItem { title, school, submitter, wait, diff = diffPage(live, version), token }
```

### Approve

```
ApprovalItem "Approve and publish"
  -> POST /api/pages/:id/approve   body = token { versionId, updatedAt }
  -> approvePage(req, id, token)
       not district-admin            -> 403 forbidden   (before any read)
       latestVersion() missing       -> 404 not-found
       checkApproval:
         reviewState != submitted    -> 409 not-waiting
         token != latest (id AND updatedAt) -> 409 changed
       payload.update(id, { ...version content, _status: 'published' }, as the reviewer)
         -> pagesUpdateAccess, publishGate, applyReviewState (clears), revalidateOnPublish
  -> 200 { ok: true }
```

`updatedAt` is in the token because autosave rewrites the latest version in place (same id).

### Request changes

`checkNote` in the browser, then `PATCH /api/pages/:id?draft=true { reviewState: 'changes-requested',
reviewNote }` — the transition in §3.

### Revalidation

`afterChange` on `pages`: when `doc._status === 'published'`, `revalidatePath('/sites/{hostname}',
'layout')` for the owning tenant. Draft saves do nothing. Errors are logged and never fail the
write; "static generation store missing" (outside Next) logs at debug.

### Diff

| Field              | Label                         | Shown as                                    |
| ------------------ | ----------------------------- | ------------------------------------------- |
| `title`            | Title                         | text                                        |
| `slug`             | Address                       | `/slug`                                     |
| `pageType`         | Page type                     | option label                                |
| `visibility`       | Who can see it                | Anyone / Staff only                         |
| `parent`           | Placed under                  | parent title, or Top of the site            |
| `meta.title`       | Title in search results       | text                                        |
| `meta.description` | Description in search results | text                                        |
| `body`             | —                             | block LCS: added / removed, unchanged count |

A never-published page diffs as new: the first five always, `meta` when set, every body block added.

### Not here yet

- Emails: submitter on outcome in §11; district digest and overdue alert in §12.
- Cloudflare purge on publish (`09` §4.2).
- The queue lists `pages` only; posts and events join with their modules.

## 10. The Publish slot on a waiting page

`publishControlFor(user, reviewState)` in `src/admin/SendForApproval/review-status.ts` decides what
`SendForApprovalButton` renders in Payload's `PublishButton` slot.

| User                           | `reviewState` | Renders                                                                 |
| ------------------------------ | ------------- | ----------------------------------------------------------------------- |
| school manager                 | any           | "Send for approval"                                                     |
| district admin (or both roles) | `submitted`   | link "Review in the approval queue" -> `/admin/approvals#approval-{id}` |
| district admin                 | anything else | Payload's `PublishButton`                                               |
| anyone else                    | any           | Payload's `PublishButton` (renders nothing without permission)          |

`reviewState` is read from the form, so the control follows the page as it is loaded.

When the queue link is present, `send-for-approval.css` also hides Payload's "Revert to published"
(`#action-revert-to-published`): reverting would replace the school's submission (`04` §4.4).

Each queue item is an `<article id="approval-{id}" tabindex="-1">`, the link's target.

UI only. A district admin's direct REST publish is not version-checked; the queue's endpoint is.

## 11. The submitter's email on approve or request changes

### Files

| File                                              | Holds                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/lib/review-emails.ts`                        | `reviewOutcome`, `outcomeEmail`, `publicUrlFor` (pure)                             |
| `src/collections/hooks/notify-review-outcome.ts`  | `makeNotifyReviewOutcome` + `userEmail`, `schoolOf`, `pagePath`, `sendWithPayload` |
| `tests/unit/lib/review-emails.test.ts`            | The pure parts                                                                     |
| `tests/unit/access/notify-review-outcome.test.ts` | The hook with injected collaborators                                               |
| `tests/integration/review-emails.test.ts`         | Inside real Payload, `payload.sendEmail` spied                                     |

Changed: `src/collections/Pages.ts` (second `afterChange`), `src/payload.config.ts` (`email`),
`package.json` (`@payloadcms/email-resend` 3.87.0, exact), `.env.example`, `playwright.config.ts`
and `tests/setup/env.ts` (force `RESEND_API_KEY` empty).

### When it sends

`reviewOutcome(previousDoc, doc)`:

| `previousDoc.reviewState` | `doc`                                    | Outcome             |
| ------------------------- | ---------------------------------------- | ------------------- |
| `submitted`               | `_status: published`, `reviewState` null | `approved`          |
| `submitted`               | `reviewState: changes-requested`         | `changes-requested` |
| anything else             | anything                                 | none — no email     |

Recipient: the user in `previousDoc.submittedBy` (an approval clears it on `doc`).

### What it sends

| Outcome             | Subject                      | Link                                                                     |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `approved`          | `Your page is live: {title}` | `publicUrlFor(NEXT_PUBLIC_SERVER_URL, school hostname, page path)`       |
| `changes-requested` | `Changes needed: {title}`    | `{NEXT_PUBLIC_SERVER_URL}/admin/collections/pages/{id}`; the note quoted |

Plain text and HTML; title and note HTML-escaped, line breaks stripped from the subject.

### Delivery

`payload.sendEmail` -> `resendAdapter` when `RESEND_API_KEY` is set; otherwise Payload has no
adapter and logs the message. From: `RESEND_FROM_ADDRESS`, default `onboarding@resend.dev` (Resend
delivers that only to the account owner). Failures are logged; the write still succeeds.

The adapter also carries Payload's forgot-password email.

## 12. The district digest and overdue alert

### Files

| File                                        | Holds                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/lib/district-digest.ts`                | `isDigestTime`, `newlyOverdue`, `digestEmail`, `overdueAlertEmail`, `districtMail`, `DIGEST_HOUR = 7` (pure) |
| `src/jobs/district-digest.ts`               | `districtDigestTask` (Payload task `districtDigest`), `runDistrictDigest`                                    |
| `src/instrumentation.ts`                    | `register()`: `getPayload({ config, cron: true })` at server start, Node runtime only                        |
| `tests/unit/lib/district-digest.test.ts`    | The pure parts                                                                                               |
| `tests/integration/district-digest.test.ts` | Inside real Payload, `payload.sendEmail` spied; through `payload.jobs.queue` + `run`                         |

Changed: `src/payload.config.ts` (`jobs`), `src/lib/queue-age.ts` (moved from
`src/admin/Approvals/`; now exports `DISTRICT_TIME_ZONE`), `src/lib/review-emails.ts` (exports
`emailDocument`, `escapeHtml`, `oneLine`, `SIGN_OFF`), `tests/integration/tenant-isolation.test.ts`
(the jobs queue is district-only).

### Schedule

| Setting                  | Value                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Task schedule            | `0 * * * *` on queue `default` — hourly, server clock                              |
| `jobs.autoRun`           | `*/5 * * * *` — queues each task's next scheduled run and runs what is due         |
| Crons start              | first `getPayload({ cron: true })` — `src/instrumentation.ts`, or an admin request |
| Time the task decides by | `job.waitUntil` (the hour it was scheduled for), else now                          |
| `retries`                | 0                                                                                  |

`districtMail({ pages, at, timeZone: DISTRICT_TIME_ZONE, queueUrl })`:

| `at` (district time)              | Sends                          |
| --------------------------------- | ------------------------------ |
| not a weekday, or hour is not 7   | nothing                        |
| 7am weekday, nothing waiting      | nothing                        |
| 7am weekday, pages waiting        | digest                         |
| 7am weekday, a page newly overdue | digest, then the overdue alert |

Newly overdue: `describeWait(sentAt, at).overdue` and not `describeWait(sentAt, at - 24h).overdue`.

### Reads

As the platform (`overrideAccess: true`):

- `pages`, `draft: true`, `reviewState = submitted`, sorted by `submittedAt`, unpaginated
- `tenants` by id, for school names
- `users` with `roles` in `[district-admin]` — the recipients

### What it sends

| Email  | Subject                                                    | Body                                             |
| ------ | ---------------------------------------------------------- | ------------------------------------------------ |
| digest | `{n} page(s) waiting for approval`, `({k} overdue)` if any | each page: title — school — wait label (overdue) |
| alert  | `Overdue: {n} page(s) waiting more than 3 school days`     | each newly overdue page: title — school — wait   |

Both link to `{NEXT_PUBLIC_SERVER_URL}/admin/approvals`. One message per admin per email; a
failed send is logged and the loop continues.

### Access

| Surface                                       | Allowed        |
| --------------------------------------------- | -------------- |
| `jobs.access.run` / `queue` / `cancel`        | district admin |
| `payload-jobs` read                           | district admin |
| `payload-jobs` create / update / delete (API) | nobody         |

The runner writes the table with access bypassed.

---

## 13. Auto-approval grants

### Files

| File                                      | Holds                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/access/auto-approval.ts`             | `GRANT_SCOPES`, `AUTO_APPROVAL_RULES`, `grantsOf`, `applicableScopes`, `decideAutoApproval` (pure)                            |
| `src/admin/Grants/GrantScopesField.tsx`   | `users.autoApprove` rendered as a fieldset of native checkboxes                                                               |
| `src/admin/Grants/GrantsPanel.tsx`        | Dashboard panel (`beforeDashboard`, after the waiting banner), district admins only                                           |
| `src/admin/Grants/grant-data.ts`          | `findGrantHolders` — `users` where `autoApprove` in the known scopes, read as the viewer                                      |
| `src/admin/Grants/grants.ts`              | `grantRows` — one row per holder: name, else email, else `User {id}`; scopes as labels; sorted (pure)                         |
| `tests/unit/access/auto-approval.test.ts` | The boundary, against a synthetic rule table; the real table's `pages` entry                                                  |
| `tests/unit/admin/grants.test.ts`         | `grantRows`                                                                                                                   |
| `tests/integration/auto-approval.test.ts` | A manager holding every grant still queues a page; only the district issues a grant; `findGrantHolders`                       |
| `tests/e2e/auto-approval-grants.spec.ts`  | Grant → dashboard → revoke through the admin; axe on the field and the panel, both themes. Serial: the tests share one holder |

Changed: `src/collections/Users.ts` (`autoApprove` options from `GRANT_SCOPES`, custom Field
component), `src/access/types.ts` (`AuthUser.autoApprove`), `src/payload.config.ts`
(`beforeDashboard`). The stored shape is unchanged — `select hasMany`, table `users_auto_approve` —
so there is no migration.

### `decideAutoApproval({ user, change, rules? })`

`change = { collection, isCreate, changedFields, requiresTranslationReview }`. Checked in order;
the first match queues:

| Check                                                          | Reason                 |
| -------------------------------------------------------------- | ---------------------- |
| user is not a school manager                                   | `not-a-school-manager` |
| no known scope held that the collection defines                | `no-grant`             |
| `requiresTranslationReview`                                    | `translation-review`   |
| `isCreate` and the collection's `createAllowed` is false       | `new-document`         |
| any changed field is in the collection's `neverFields`         | `never-field`          |
| no changed fields                                              | `nothing-changed`      |
| no held scope's `permits(change)` is true for the WHOLE change | `outside-every-scope`  |

Otherwise `{ approve: true, scope }`. A `permits` that throws counts as false. `grantsOf` keeps
only strings in `GRANT_SCOPES`, once each; anything else in the field grants nothing.

### The rule table

| Collection | `neverFields`                                                | `createAllowed` | Scopes |
| ---------- | ------------------------------------------------------------ | --------------- | ------ |
| `pages`    | `body`, `layout`, `pageType`, `parent`, `visibility`, `meta` | false           | none   |

A unit test fails if a `richText`, `upload` or `blocks` field is added to `Pages` without joining
`neverFields`.

### Not here yet

- **Nothing calls `decideAutoApproval` on a write.** No collection has a scope, so every send
  queues through the review-state hook unchanged. Posts (`posts:routine`) and events
  (`events:schedule`) add their rules and the call in Phase 5, with the publish-on-behalf path:
  published as the submitter, audited, flagged as auto-approved.
- Grant changes are not audited, and there is no 30-day post-hoc review list: both need the
  audit trail.

---

## 14. Page history is district-only

Jason, 2026-10-27: a school manager sees no version history and restores nothing.

### Files

| File                                         | Holds                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/access/pages.ts`                        | `canUsePageHistory` (district admin), `pagesReadVersionsAccess` (boolean)                   |
| `src/collections/hooks/page-history.ts`      | `restoreIsDistrictOnly` — `beforeOperation`, refuses `restoreVersion`                       |
| `tests/unit/access/pages.test.ts`            | `canUsePageHistory`, `pagesReadVersionsAccess`                                              |
| `tests/unit/access/page-history.test.ts`     | `restoreIsDistrictOnly` by role, operation and `overrideAccess`                             |
| `tests/integration/tenant-isolation.test.ts` | "page history is district-only" — Local API, a school's OWN page                            |
| `tests/e2e/page-history.spec.ts`             | No Versions tab for a school; REST list → 403, REST restore refused; district keeps the tab |

Changed: `src/collections/Pages.ts` (`access.readVersions`, `hooks.beforeOperation`).

### Who may

| Operation                                                           | District admin | School manager | Sync | Anonymous |
| ------------------------------------------------------------------- | -------------- | -------------- | ---- | --------- |
| `findVersions`, `findVersionByID`, `countVersions` (`readVersions`) | yes            | no             | no   | no        |
| `restoreVersion` (hook; Payload itself checks `update`)             | yes            | no             | no   | no        |
| `findByID` / `find` with `draft: true` (`read`)                     | unchanged      | unchanged      | —    | —         |

`overrideAccess: true` (the Local API default) skips the hook. Before this, Payload's
`readVersions` default was any signed-in user (narrowed to their schools by the tenant plugin),
and `restoreVersion` checked only `update` — so a school manager could restore any past version
of their own page, the published one included, as a draft.

### Not here yet

- GraphQL is not exercised: the schema does not build (`users.autoApprove` values contain `:`,
  which Payload's `formatName` keeps), so `/api/graphql` errors for every caller.
