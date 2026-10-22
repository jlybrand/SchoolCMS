# Phase 4 — Approval workflow and the two admin planes

How a school's change reaches the public: the review state on `pages`, who may move it, and
(as later slices land) the school plane's one button, the district queue, auto-approval
grants, notifications and audit.

Phase 4 lands across several PRs. This document is written as each one merges.

| Slice                                          | State               |
| ---------------------------------------------- | ------------------- |
| Review state on `pages`                        | **This PR** — §1–§4 |
| School plane: task view, "Send for approval"   | —                   |
| District queue: inline diff, one-click approve | —                   |
| Auto-approval grants (zero issued)             | —                   |
| Request changes UI, notifications, escalation  | —                   |
| Audit trail                                    | —                   |

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
- No UI moves the state: the fields are read-only. The school's button and the district's
  actions are the next slices.
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
