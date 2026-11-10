# 04 — Authoring Model & Approval Workflow

Who edits what, what they see when they log in, and how a change reaches the public. This
is the document that most distinguishes this platform from a general CMS, and the one whose
failure mode is most damaging: **if approval is slow, schools stop submitting and the sites
go stale** — which is the problem the project exists to solve.

## 1. Two planes, one data model

| | **District plane** | **School plane** |
|---|---|---|
| Users | 1–3 district communications staff | ~30–50 school staff |
| Frequency | Daily | A few times a year |
| Training | Author is the builder | **None — assume zero** |
| Publishes directly | Yes | **No** — submits for approval |
| Scope | All 28 tenants | Their tenant only |
| Interface shape | Dense, cross-tenant, collection-oriented | Sparse, single-tenant, **task-oriented** |
| Capabilities | Everything, incl. blocks, syndication, alerts, theme, navigation | Fixed page types, posts, events, media, documents |

Both planes are the Payload admin, differentiated by role-conditional navigation, access
functions, and admin components — **not two applications**. Payload's `admin.condition`,
custom views, and access functions carry this; nothing bespoke is required.

## 2. The school plane

### 2.1 Design bar

The usability NFR (`01` §6) is deliberately extreme: *a school manager who last logged in
five months ago, attended no training, and reads no documentation completes their task
unaided.* Everything below follows from that.

**What that rules out:** collection-oriented navigation, the word "collection," draft
versus published as a visible concept, tenant switchers, bulk operations, field-level
help that lives in a manual, and any screen where the primary action is ambiguous.

### 2.2 Landing view — verbs, not collections

On login a school manager sees a short list of **tasks**, not a data model:

- **Add a meeting date**
- **Post an announcement**
- **Update a page**
- **Upload a document**
- **Add a photo**

Each is a single short form. Tenant is already resolved from the user's assignment — never
asked. Below the tasks sits **"Your recent submissions"** with plain status: *Submitted ·
Published · Needs changes*.

Implemented as a custom Payload admin root view for the `school-manager` role. The
underlying collection views remain reachable but are not the default path.

### 2.3 One button

Every school-plane form submits with a single button labelled **"Send for approval."** Not
"Save," not "Publish," not "Save draft."

This matters more than it looks. Payload's native draft/publish controls present a
save-then-publish model where the publish action is visibly disabled for this role — which
reads as a broken interface to someone who logs in twice a semester. The custom submit
control replaces it entirely for `school-manager`.

**Nothing is lost on submit.** In-progress work autosaves as a draft; the button transitions
it to submitted.

### 2.4 Page editing

School managers edit **fixed page types** with typed fields (`03` §2). No block array, no
layout choices, no page-type conversion.

**Creating a page** is constrained more tightly than editing:
- The page type is chosen from a short list with plain-language descriptions.
- The slug is auto-generated from the title and not editable.
- The page does not enter navigation until the district places it during approval —
  preventing orphaned pages nobody links to and nobody remembers.

*(School-level composition: **enabled 2026-11-04 (Jason), level B** — schools compose with the
simple components around the district's — `01` §4.1. Every change still goes through approval, and
the queue lists section changes: added, removed, changed, moved.)*

### 2.5 Uploads

**Alt text is required at the point of upload, not caught at review.** If missing alt text
reached the approval queue, the district would be writing alt text for 28 schools — the
work would simply relocate.

The upload form asks: *"Describe this image for someone who can't see it."* A **"This image
is decorative"** checkbox is the honest escape hatch, and selecting it is recorded. Enforced
by field validation and a `beforeValidate` hook (`03` §2, `media`).

**Documents** additionally require the remediation attestation (`07` §5) — a checkbox with
plain-language text, recorded with actor and timestamp.

### 2.6 Pasting

Meeting agendas and notices arrive pasted from Word or Google Docs. The paste handler
normalizes on entry: strips to the element allowlist, reconstructs real lists from bullet
characters and numbering, and offers one prompt to promote candidate headings. Full
specification in `07` §4.

The school manager is never asked to understand what a heading is — they are asked *"These
lines look like headings. Mark them as headings?"* and click yes.

### 2.7 What school managers cannot do

Theme, navigation structure, syndication scope, alerts, blocks, page-type conversion,
PowerSchool-sourced person fields, other tenants, user management, translation values,
publishing anything.

## 3. The district plane

### 3.1 Dashboard

The district admin's landing view answers the questions actually asked on login:

1. **Approval queue** — count and the oldest pending item's age.
2. **Freshness** — tenants whose content has not changed in 90+ days, and key pages
   (homepage, calendar, contact) that are stale.
3. **Sync status** — last PowerSchool run, counts, errors (`11` §10).
4. **Live alerts** — what is currently displaying, on which tenants.
5. **Work queues** — documents marked `not-attested`; media flagged decorative in bulk;
   pages awaiting translation verification (`08` §8.1).
6. **Auto-approval grants** — who currently holds which scopes, and auto-approved changes
   from the last 30 days for spot-checking (`04` §4.3).

### 3.2 Cross-tenant by default

The district works across 28 sites, so list views default to **all tenants with a tenant
column and filter**, rather than a tenant switcher that must be toggled. The multi-tenant
plugin's scoping is applied but not narrowed by default for this role.

### 3.3 Composition

Every page uses the block array (`03` §3): a vertical list of blocks with
reorder controls and a form per block. No canvas, no drag-and-drop. Nesting is one level deep,
through `Columns` (Jason, 2026-11-04): a column holds blocks, never further columns. At 1–2 pages
a month this is correct and does not warrant more.

Preview is the page rendered on the preview host.

### 3.4 Alerts

Emergency alerts are **template-driven** (`03` §2, `08` §8.2): select a template, fill
variables, choose scope and severity, publish. Every Tier 1 locale publishes instantly with
human-verified wording.

Free-text alerts remain available for novel situations and machine-translate with a visible
disclosure. **The template path is the default**; free text requires an extra confirmation
step, because 5am is the wrong time to be composing prose in six languages.

## 4. Approval workflow

### 4.1 Model

Built on Payload drafts and versions — **no parallel change-request system** (`03` §7).

- A `reviewState` field on approvable collections: `editing` | `submitted` |
  `changes-requested`.
- School manager saves → draft, `reviewState: editing`.
- School manager sends for approval → `reviewState: submitted`.
- District approves → document publishes; `reviewState` clears; revalidation fires.
- District requests changes → `reviewState: changes-requested` with a reviewer note; the
  draft remains editable by the school manager.
- The publish transition is gated to `district-admin` at the access and hook layer
  (`03` §6.2) — enforced on every route, not just in the UI.

Settled in implementation (`src/access/review-state.ts`):

- "Clears" means `null` — nothing pending. There is no `approved` state; a published page
  with no pending draft has no review state.
- A school manager's further save on a submitted item **keeps it submitted**, with its
  original `submittedAt`. Payload merges the stored document into every write, so a save
  and a resend are indistinguishable. The race that leaves — approving content that changed
  after the reviewer looked — is closed in the queue (§4.2): approve publishes the version
  the reviewer saw.
- `changes-requested` persists through the school's edits until they resend, so the note
  stays visible. The note clears on resend and on approve; versions keep the history.
- Request changes is valid only on a `submitted` item, and requires a note (§4.4).
- Autosave is on, with draft validation (Jason, 2026-10-21): a changed field saves itself as a
  draft and never moves the review state. A brand-new page autosaves from its first save on —
  without validation, Payload creates an empty draft the moment the create view opens.

### 4.2 The queue

A dedicated district view listing pending submissions across all tenants: tenant, content
type, title, submitter, age, and **an inline diff of the change**.

**Approve must be one click from the diff.** Most submissions will be "changed a date" or
"added a meeting." If approving requires opening each document, the district becomes the
bottleneck, schools stop bothering, and the sites go stale — the exact failure this platform
exists to prevent. This is a hard design requirement, not a nicety.

Diffs render field-by-field for typed content and as a rendered-HTML comparison for rich
text.

### 4.3 Auto-approval — off by default, granted per editor

**Every submission is reviewed. There is no collection-level or content-type default that
bypasses review.**

Auto-approval exists only as an **explicit, per-user grant** made by a `district-admin` to a
named school manager. It is a statement about a person, not about a content type: *this
editor has demonstrated they can be trusted with this kind of change.*

**Grant shape** — an `autoApprove` field on the `users` document (`03` §2), holding zero or
more scopes:

| Scope | Permits without review |
|---|---|
| `events.schedule` | Creating or editing an event where only `title`, `start`, `end`, `location` changed |
| `posts.routine` | Publishing a post with no upload and no page-structure change — **its body included** (see below) |
| *(none — the default)* | Nothing. All submissions queue. |

**Never auto-approvable, regardless of grant:**

- Anything touching `agendaBody` or other rich text — **except an announcement's own body
  under `posts.routine`** (decided by Jason, 2026-10-28)
- Any change involving an upload (image or document)
- New page creation, or any change to page type
- Any change to `visibility`, `seo`, navigation placement, or syndication
- Anything on a page flagged `requiresTranslationReview`

If a submission mixes an auto-approvable change with a non-auto-approvable one, **the whole
submission queues.** There is no partial approval.

**`posts.routine`, as built (Jason, 2026-10-28).** The scope and the rich-text rule above
contradicted each other: read literally, the grant could never approve a new post, because a
post's body is rich text. Resolved as a narrow exception: under `posts.routine` an
announcement's own `body` may be auto-approved, so creating or editing a routine announcement —
the picture-day notice the grant exists for — publishes at once. Everything else on the never
list still queues the whole submission: an upload (`heroImage`, Phase 6), `visibility`,
`syndication`, `publishedDate`, `requiresTranslationReview`; and moving a live announcement to a
new address is a page-structure change. Rich text stays never-auto-approvable everywhere else —
page bodies, `agendaBody`, layouts. The publish happens in the same transaction as the send,
writes an `auto-approve` audit entry naming the sender and the grant, sends no outcome email
(nobody approved anything), and appears on the district's 30-day spot-check list.

**Governance:**

- Grants are made deliberately in the admin, recorded in the audit trail with actor and
  timestamp, and revocable at any time.
- The district dashboard lists who currently holds which grants — so an inherited grant
  from a previous administrator is visible rather than forgotten.
- Auto-approved changes still write to the audit trail and appear in the district activity
  feed, flagged as auto-approved. **Invisible approval, never invisible change.**
- A **post-hoc review list** shows auto-approved changes from the last 30 days, so the
  district can spot-check that a grant is still warranted.

**Recommended posture:** launch with **no grants issued at all**. Run the queue fully
manual through the pilot and early rollout. Issue grants only where a specific editor's
volume is demonstrably causing queue drag — never pre-emptively, and never to a role or a
tenant as a class.

### 4.4 Rejection

"Request changes" requires a note. The note is shown to the school manager in plain language
at the top of the item, with the submission preserved and editable. **No submission is ever
discarded by the reviewer.**

### 4.5 Notifications

- Submitter → email on approve or changes-requested (Resend).
- District → daily digest of pending items, plus an immediate email if any item exceeds
  the age threshold.
- No per-submission email to the district; that becomes noise and gets filtered.

## 5. Coverage and absence

**A single approver is a single point of failure for 28 schools.** Required, not optional:

- **A second `district-admin`** with equal approval rights. Whoever holds it must be able to
  approve competently, which mostly means being able to spot bad alt text and heading
  misuse.
- **An age-based escalation:** items pending beyond the threshold (suggest 3 business days)
  trigger an alert to both approvers.
- **Optional per-tenant delegation:** a `tenant-approver` capability allowing a
  principal-level user to approve their own school's low-risk changes. Not built in v1;
  the role structure accommodates it (`03` §6.1). Consider it if the queue becomes a
  bottleneck rather than pre-emptively.

**Planned absence:** the runbook (`09` §7) covers designating temporary approval coverage
before extended leave. Approval coverage during closures and summer is a real operational
question, not an edge case.

## 6. Accessibility of the authoring interfaces

**In scope, and frequently forgotten** (`01` §6). DD2 staff may author using assistive
technology, and an inaccessible admin excludes them from their own job.

- Both planes are in the axe CI gate, not just public templates.
- Keyboard-only completion of each of the five school tasks is a release check.
- Screen-reader smoke test on the school plane's task forms and the district approval queue
  each release.
- Custom admin components (task landing view, submit control, diff viewer, block list) carry
  the same conformance bar as public blocks, including visible focus and accessible names.
- Error messages are specific and text-based, never colour-only.

Payload's admin is reasonably accessible but not audited to AA; custom components are where
regressions will originate, so that is where testing concentrates.

## 7. Localization interaction

- School managers never see or edit translations. Their content flows through the pipeline
  automatically (`08`).
- Pages flagged `requiresTranslationReview` publish in English on approval; Tier 1 locale
  variants hold for verification (`08` §8.1). The district dashboard surfaces the pending set.
- Translation verification is a `district-admin` action (or a future dedicated role) and is
  separate from content approval — a page can be published and awaiting translation review
  simultaneously.

## 8. Audit

Every submit, approve, request-changes, auto-approve, publish, and delete records actor,
tenant, timestamp, and content type (`03` §7). Auto-approvals are marked as such. This is
the accountability record for both accessibility defensibility and ordinary "who changed
this" questions.

## 9. Acceptance criteria for this document

1. Each of the five school tasks completed unaided by a real DD2 school manager with no
   training and no documentation (`01` §7.4).
2. A school manager cannot publish by any route — admin, REST, GraphQL, or bulk operation
   (`03` §6.4, invariant 5).
3. **With no grants issued, every school submission queues for review** — proven for each
   content type. A granted scope permits only its exact change class; a mixed submission
   queues in full.
4. Approve-from-diff is one click and is measured; median approval time is tracked after
   cutover.
5. Alt text cannot be omitted on a non-decorative upload.
6. Both admin planes pass the axe gate and keyboard-only task completion.
7. Emergency alert publishes to all Tier 1 locales from a template in under 60 seconds.
