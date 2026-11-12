# 06 — Testing Strategy

Testing is a build-time gate, not a phase at the end. Nothing merges that fails typecheck,
unit, integration, e2e smoke, or the accessibility gate.

**Two suites in this document are load-bearing rather than routine.** Tenant isolation
(§2.2) is the *only* thing standing where database row-level security would have stood
(`02` §4.2), and the PowerSchool no-student-data gate (§2.2) is release-blocking. Neither
may be skipped, weakened, or marked flaky-and-ignored.

## 1. Test pyramid (with the axes this project needs)

```
                 ┌──────────────────────────────┐
                 │   Manual AT + UAT            │  screen readers, keyboard, editor tasks
                 ├──────────────────────────────┤
                 │   E2E (Playwright)           │  real flows across tenants and roles
                 ├──────────────────────────────┤
                 │   Integration                │  access control, API, DB, hooks, sync
                 ├──────────────────────────────┤
                 │   Unit (Vitest)              │  blocks, utils, access fns, mappers
                 └──────────────────────────────┘
   Cross-cutting: Accessibility (axe) · Localization · Performance · Security · Boundary
```

## 2. Layers

### 2.1 Unit — Vitest

- **Access-control functions:** table-driven per role × tenant × collection asserting
  allow/deny. The security core; highest priority.
- **Blocks/components:** correct render for given props; a11y attributes present; theme
  tokens applied; **block-owned heading levels correct regardless of position**. Paired
  with axe checks (§3).
- **Paste normalizer:** the highest-value unit suite in the project. Fixtures of real Word
  and Google Docs paste payloads assert that inline styles, `mso-*` attributes, `<span>`
  soup, and font declarations are stripped; that bullet characters and numbering become
  real `<ul>`/`<ol>`; that smart quotes and non-breaking spaces normalize; that tables are
  rejected with a message; and that heading candidates are *offered*, never silently
  promoted (`07` §4).
- **Utilities:** tenant resolution from hostname, slug generation, recurrence expansion,
  iCal serialization, SEO/OG assembly, migration field mappers, **string hashing for the
  translation cache** (stability across whitespace and entity variations).
- Fast, deterministic, no network or DB.

### 2.2 Integration

- **API + access control together:** hit REST/GraphQL/Local API as each role and assert
  tenant-scoped results; assert the public surface never returns drafts, staff-visibility
  content, version history, or user records.
- **Tenant isolation — the primary guarantee.** For every tenant-owned collection and
  every role, attempt cross-tenant read, create, update, and delete via REST, GraphQL, and
  bulk operations. Assert denial. Assert that syndicated *published* content is the only
  cross-tenant read that succeeds (`03` §6.4). **Run on every build; never quarantined.**
- **Publish gate:** a `school-manager` cannot transition any document to published by any
  route — direct field write, hook bypass attempt, bulk update, or API call (`03` §6.4,
  invariant 5).
- **Auto-approval grants:** with no grants issued, every school submission queues, for each
  content type. A granted scope permits only its exact change class. **A mixed submission
  queues in full** (`04` §4.3). Grant changes are audited.
- **Approval workflow:** submit → `reviewState: submitted`; approve → published +
  revalidation fires with correct cache tags; request-changes preserves the draft and
  attaches the note; nothing is ever discarded.
- **Entra ID auth:** group → role mapping; tenant assignment on login; a disabled Entra
  account cannot authenticate; the break-glass account is excluded from normal login paths.
- **Hooks:** publish → revalidate/purge with correct tags; COPE syndication purges every
  surface rendering the item; `alt` cannot be null unless `isDecorative`.
- **PowerSchool staff sync (`11`):** against a **mocked OneRoster fixture seeded with
  student records**, assert the **release-blocking no-student-data invariant** (zero
  student records ever persisted; only staff-role, allowlisted fields mapped); upsert
  idempotency; building→tenant routing; merge policy (CMS-owned `bio`/`visibility`/local
  photo survive; source fields overwrite); soft-hide on departure; resilience (simulated
  API failure keeps last-known-good, never wipes; logs contain no PII).
- **Localization pipeline (`08`):** override precedence over machine output; Payload
  localized value precedence for verification-flagged content; glossary terms untranslated
  and wrapped with `lang`; cache hit on unchanged source; **cache miss on changed source**
  (proving translations cannot go stale); Tier 2 locale enabled by config alone; translation
  API failure serves cached values and falls back to source for new strings only.
- **DB/migrations:** schema migrations apply cleanly up and down on a disposable Postgres.

Runs against an ephemeral Postgres with seeded fixtures.

### 2.3 End-to-end — Playwright

Real browser flows, multi-tenant and multi-role:

- **School manager:** log in via Entra (mocked IdP) → add a meeting date → send for
  approval → confirm it is *not* live → district approves from the queue → confirm live on
  the correct subdomain within N seconds.
- School manager attempts to publish directly → blocked.
- School manager uploads an image without alt → blocked; with the decorative flag → allowed
  and recorded.
- Pastes Word-formatted agenda text → stored markup is clean; heading prompt appears.
- **District:** builds a composed page from blocks → previews → publishes.
- **Approval queue:** diff renders; one-click approve works; request-changes returns the
  item with a note.
- **Syndication:** district post appears on a subscribed school tenant; an edit propagates.
- **Staff visibility:** signed-out user cannot reach a `visibility: staff` page; signed-in
  staff can.
- **Emergency alert:** template selected → publishes to all Tier 1 locales in under 60s.
- **Tenant isolation e2e:** authenticated as school A, attempt to reach school B's admin or
  content → denied.
- **Search** returns scoped, accessible results.

### 2.4 Accessibility — mechanics here, conformance plan in `07`

- **Automated (CI gate):** `@axe-core/playwright` on every public template **and both admin
  planes**; **zero critical/serious violations to merge.** Lighthouse CI a11y score as a
  secondary signal.
- **Component-level:** axe assertions in unit/Storybook tests so a block cannot regress in
  isolation. Every new block registers its axe test in the same PR.
- **RTL:** every layout tested under `dir="rtl"`; visual regression catches mirroring
  failures. A lint rule bans physical CSS properties (`05` Phase 0).
- **Manual (per release):** keyboard-only pass on public templates **and the five school
  tasks**; screen-reader smoke (NVDA + VoiceOver) on core templates, the school task forms,
  and the approval queue; zoom/reflow at 200%/400%; contrast spot-checks;
  motion/reduced-motion.
- **Documents:** attestation coverage is reported, not validated in CI (`07` §5). The test
  asserts that an unattested document is surfaced on the district work queue.

### 2.5 Localization

- `lang` on `<html>` matches the rendered locale; `dir="rtl"` for Arabic.
- `lang` emitted on untranslated glossary spans inside translated pages.
- Every template renders in all five Tier 1 locales without layout breakage; text expansion
  tested at 130% and contraction at 70%.
- CJK line-breaking and font fallback correct; **font payload measured against the LCP
  budget**.
- Language switcher: each option in its own script, with `lang`, keyboard-operable, and
  announced correctly.
- Emergency alert templates: verified translation present for every Tier 1 locale before
  release.

### 2.6 Performance

- **Lighthouse CI** on PRs: Core Web Vitals budgets (LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1)
  and bundle-size budgets; regressions fail.
- Budgets measured **per locale** for Tier 1 — a CJK font regression must fail the gate,
  not pass because English is fine.
- **k6 load/spike tests** (pre-cutover + release): simulate a 100× weather-day spike; assert
  the CDN absorbs it with no origin scaling and no error-rate increase; verify the alert-bar
  fragment updates under load.

### 2.7 Security

- Dependency + SAST scans in CI (audit, CodeQL or equivalent).
- Tenant-isolation and authz suites (§2.2) on every build.
- Upload allowlist and MIME-verification tests; embed domain allowlist enforced.
- Rich-text sanitization asserted on write **and** render.
- Pre-cutover: OWASP ASVS L2 checklist review; header/CSP verification; rate-limit tests;
  secrets scan.

### 2.8 Boundary (the swap hedge)

- **Lint gate:** no file under `src/app/**` imports the Payload SDK (`02` §11). A CI
  failure, not a code-review convention.
- A smoke test asserts every `src/content/*` function returns DD2 domain types, not Payload
  generated types.

## 3. CI gate order (fail fast)

```
typecheck → lint (incl. boundary + logical-properties rules) → unit → integration
  → build → e2e (full suite, 2 shards) → axe gate → lighthouse budget
                                          │
   (nightly / pre-release) → full e2e matrix · localization matrix · k6 spike
                             · security scan · manual AT
```

- **Blocking on every PR:** typecheck, lint, unit, integration, build, the full e2e suite
  (Chromium, sharded across two machines), **axe**. Smoke alone let a regression in an untagged spec
  through (2026-11-12), so smoke stays a local shortcut, not the gate.
- **Blocking on a PR that can affect them:** the Storybook component axe gate (anything outside
  the admin, collections, access, content layer and tests), the Lighthouse budget (anything
  outside the admin planes and tests — it audits the public home page), the dependency audit
  (the lockfile or CI itself). Every push to `main` runs all three. A prose-only PR (docs,
  `starterDocs/`, Markdown) runs no CI; the job `changes` in `.github/workflows/ci.yml` holds
  the lists.
- **Blocking on release/pre-cutover:** full e2e matrix, localization matrix across Tier 1,
  k6 spike, security review, manual AT conformance sign-off.

## 4. Environments

| Env | Purpose | Data |
|---|---|---|
| Local | Dev + unit/integration | Docker Postgres, seeded fixtures, `*.localhost` tenants, mocked IdP |
| CI | Every PR gates | Ephemeral Postgres + R2 mock; fixtures; mocked Entra and translation API |
| Preview | Per-PR deploy for review + e2e/a11y/Lighthouse | Sanitized sample content |
| Staging | Pre-prod; full audit, k6 spike, UAT | Migrated sample or pilot-tenant data |
| Production | Live | Real content |

## 5. Test data & fixtures

Deterministic seed, code-generated, reset between runs:

- ≥3 tenants (district + 2 schools), users per role, **one user with an auto-approve grant
  and one without**.
- Sample content per module; cross-tenant content for isolation tests.
- **Word and Google Docs paste payloads** captured from real DD2 content — the paste
  normalizer's fixture corpus.
- A **mocked OneRoster feed containing student records**, to prove they are rejected.
- Content in each Tier 1 locale, including a long Arabic string and a CJK string, for
  layout and font testing.
- A document with and without attestation.

## 6. Acceptance / UAT

- **Task-based UAT with real DD2 school managers**, unaided, with no training and no
  documentation, covering the five tasks in `04` §2.2. Gate for cutover (`01` §7.4).
- Recruit people who have *not* been involved in the project. Testing with staff who
  watched it being built measures the wrong thing.
- Migration validation: checksum comparison Finalsite-export → target, plus editor
  spot-review per tenant (`10`).

## 7. Coverage philosophy

Coverage targets are a signal, not a goal. **Mandatory 100%-intent coverage on five areas:**

1. Access-control and tenant-isolation functions (`03` §6.4)
2. The publish gate — school managers cannot publish by any route
3. Accessibility of shipped components and both admin planes
4. The PowerSchool no-student-data invariant (`11` §4)
5. The auto-approval grant boundary — nothing auto-approves without an explicit grant

Elsewhere, test behaviour and edges over lines.
