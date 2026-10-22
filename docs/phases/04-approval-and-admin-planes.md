# Phase 4 — Approval workflow and the two admin planes

How a school's change reaches the public: the review state on `pages`, who may move it, and
(as later slices land) the school plane's one button, the district queue, auto-approval
grants, notifications and audit.

Phase 4 lands across several PRs. This document is written as each one merges.

| Slice                                          | State                |
| ---------------------------------------------- | -------------------- |
| Review state on `pages`                        | Merged (#26) — §1–§5 |
| School plane: "Send for approval" on a page    | Merged (#27) — §6–§7 |
| School plane: task view, constrained new page  | **This PR** — §8     |
| District queue: inline diff, one-click approve | —                    |
| Auto-approval grants (zero issued)             | —                    |
| Request changes UI, notifications, escalation  | —                    |
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

- Approve publishes the latest draft. Publishing **the version the reviewer saw** is the queue's
  job (§ queue, when it lands).
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
