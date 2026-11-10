# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**DD2 Website Platform** — a district-owned, accessibility-native web platform serving one
district domain and 27 school subdomains (**28 tenants**) from a single codebase and
deployment. It replaces the rented Finalsite Composer CMS.

**Status: Phases 0–4 complete; Phase 5 next.** Phase 0 (scaffold + guardrails), Phase 1
(tenancy, roles, access control, the adversarial isolation suite), Phase 2 (edge tenant
routing, locale plumbing, the content-access layer, cache tags), Phase 3 (components,
`pages`, the block library, navigation, theme, SEO, settings) and Phase 4 (review state, the
school and district planes, the approval queue, auto-approval grants with none issued,
notifications, whole-screen axe on both planes) have landed. Phase 4's close-out, with what
it carries forward, is `docs/phases/04-approval-and-admin-planes.md` §19. Authentication
is on an **interim local-auth posture** — see "Authentication" below. `starterDocs/` holds the 12-document
design suite (v2.1, August 2026) and is the specification. Treat it as authoritative; when
code and docs disagree, that is a bug in one of them — say which.

Read `starterDocs/00-README.md` first. The others in order:

| Doc                                       | Covers                                                             |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `01-project-scope.md`                     | Scope, personas, NFRs, deferred add-ons, acceptance criteria       |
| `02-system-architecture.md`               | Stack, tenancy, delivery, availability, security, ADRs             |
| `03-data-model-access-control.md`         | Collections, fields, access model, **isolation invariants (§6.4)** |
| `04-authoring-model-approval-workflow.md` | Two admin planes, approval workflow, auto-approval grants          |
| `05-build-order-roadmap.md`               | Phase sequencing and dependency graph                              |
| `06-testing-strategy.md`                  | Test layers, CI gate order, fixtures, coverage philosophy          |
| `07-accessibility-conformance-plan.md`    | WCAG 2.1 AA by construction; paste normalizer spec                 |
| `08-localization-pipeline.md`             | Render-layer translation; locale tiers; RTL/CJK handling           |
| `09-deployment-operations.md`             | CI/CD, hosting, DR, monitoring, runbooks, dependency governance    |
| `10-migration-cutover.md`                 | Template census, extraction, per-tenant wave cutover               |
| `11-integrations-powerschool.md`          | Read-only staff sync; **no student data, ever**                    |

## Stack

TypeScript end to end. **Payload CMS 3 (pinned)** + **Next.js App Router** +
**PostgreSQL** (Drizzle adapter). Auth is **designed** as Entra ID OIDC with no password
storage, but currently runs on **interim Payload local auth** — see "Authentication" below
before touching anything in `src/auth/`. Media/docs on **Cloudflare R2**;
CDN/DNS/WAF on **Cloudflare**; translation via **Azure AI Translator** behind a swappable
interface; transactional email via **Resend**. Testing: Vitest, Playwright, axe-core,
Lighthouse CI, k6. CI on GitHub Actions.

### Pinned versions — and three places "latest" is wrong

Node **24.19.0** (Krypton, Active LTS — see `.nvmrc`; Node 20 is EOL). pnpm **11.20.0** via
corepack. Postgres **18**. Payload **3.87.0** exact-pinned across every `@payloadcms/*`
package. Next **16.3.0**, React **19.2.8**.

Three dependencies are deliberately **not** on `latest`. Do not "helpfully" bump them
without re-checking the constraint that pinned them:

| Package    | Pinned  | `latest` | Why not latest                                                                                                                                           |
| ---------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript | 6.0.3   | 7.0.2    | TS 7 is the native Go port and **ships no JS compiler API** — see below. It breaks the entire lint layer, which is where both Phase 0 guardrails live.   |
| ESLint     | 9.39.5  | 10.8.0   | `eslint-config-next` bundles eslint-plugin-import/react/jsx-a11y, all capped at `^9`. ESLint 10 leaves jsx-a11y unmet, silently weakening the a11y lint. |
| graphql    | 16.14.2 | 17.0.2   | Payload peers `^16.8.1`.                                                                                                                                 |

Revisit each when its blocker clears. Payload version bumps are always a separate PR
(`09` §2).

#### TypeScript 7 — measured, deferred (decision: 2026-08-06)

This was tested against the real repo, not assumed. Under `typescript@7.0.2`:

| Step            | Result                                               |
| --------------- | ---------------------------------------------------- |
| `tsc --noEmit`  | passes                                               |
| `next build`    | passes                                               |
| `eslint .`      | **hard error** — typescript-eslint refuses to load   |
| guardrail tests | **13 of 44 fail** — the whole content-boundary suite |

TS 7's npm package exports only `./lib/version.cjs`; `lib/typescript.js` is gone, so
`createProgram` is `undefined` and the new API lives behind `typescript/unstable/*`.
typescript-eslint therefore throws at config load rather than degrading. Its tracking issue
([#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)) is blocked
on ESLint async-parser support, so this is not landing soon.

So TS 7 costs exactly one thing: the lint layer. On a project whose whole thesis is that
conformance is structural and CI-enforced, trading the enforcement layer for ~2s of
typecheck time is a bad trade.

**When we do want it,** Microsoft's documented side-by-side layout works and needs no
workaround — TS 6 keeps the name (so tooling and the IDE resolve it) while TS 7 provides
`tsc`. The two binaries do not collide (`tsc` vs `tsc6`):

```jsonc
"devDependencies": {
  "@typescript/native": "npm:typescript@7.0.2",          // provides `tsc`
  "typescript": "npm:@typescript/typescript6@6.0.2"      // provides `tsc6` + the JS API
}
```

Note the cost that layout carries: the compiler that gates CI would no longer be the one
the IDE and typed lint rules use, so run **both** (`typecheck` and `typecheck:compat`) to
catch divergence. **Revisit trigger:** typescript-eslint ships TS 7 support, or a typecheck
slow enough to hurt the dev loop. Neither is true today.

**Plugins are deliberately minimal:** `plugin-multi-tenant`,
`plugin-cloud-storage` (R2). Nothing else without weighing swap cost (`02` §11).
`plugin-form-builder` is a _deferred add-on_, not adopted in v1. `plugin-seo` was evaluated
and **not adopted** (2026-09-21): its admin fields fail the axe gate with hardcoded inline
colours. The SEO fields are a plain `meta` group that keeps the plugin's stored shape — see
`src/collections/Pages.ts` before proposing it again.

**Never introduce:** MongoDB, per-field manual localization as the primary mechanism,
`localStorage` for application state, or a bespoke reimplementation of anything Payload already
provides.

_(School composition was on this list. **Jason decided on 2026-11-04 that all pages are composed
and schools compose at "level B"**: they edit, add, remove and reorder the SIMPLE components —
Text, Button, Cards, Accordion, Divider — and cannot touch the district's components (Columns, News
feed, Video, Section menu, and anything added later until named). The rule is
`src/access/school-layout.ts`, enforced on every route by `schoolLayoutGate`; the approval queue
diffs sections (`diffLayout`). Do not widen the palette or loosen the gate without a decision.)_

_(Local password auth was on this list and is temporarily in use — as a recorded, dated
deviation with a switch trigger, not as a reversal. See "Authentication" below. Do not read
its presence as permission to add more credential handling.)_

## Authentication — interim deviation from ADR-6

**Current: Payload local authentication (email + password).**
**Designed: Entra ID OIDC (`02` §7, ADR-6).**

A deliberate, temporary deviation to avoid a district IT dependency during development.
Recorded here rather than left implicit, because an undocumented auth deviation is exactly
the kind of thing that quietly ships.

**What survives the switch, unchanged:** roles, tenant assignment, every access function,
and the whole isolation suite. Authentication answers _who you are_; authorization answers
_what you may touch_. Only the former changes — which is what makes this affordable. The
`entraObjectId` field is already present and unused, so existing accounts get linked to
Entra objects at switchover rather than recreated.

**What local auth costs — all of it re-solved by the switch, none of it solved now:**

| Lost                                     | Consequence                                                                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Automatic deprovisioning**             | `02` §7 calls this the material advantage over local accounts. A departing employee keeps platform access until someone remembers to remove them. **This is the one that matters** — it is a standing security gap, not an inconvenience. |
| **Inherited MFA**                        | District MFA policy does not apply. The platform has none.                                                                                                                                                                                |
| **No credential storage**                | We now store password hashes, so credential handling, reset flows and lockout become ours to get right. `src/auth/password-policy.ts` exists solely for this.                                                                             |
| **No new password for infrequent users** | School managers log in a few times a year (`04` §2.1). They will forget, so password reset becomes a load-bearing path against the "no training, no documentation" bar.                                                                   |

**Switch trigger — before production with real staff accounts, not later.** The
deprovisioning gap is acceptable for development and a closed pilot; it is not acceptable
once ~30–50 school staff hold accounts. Concretely, switch before Phase 9 pilot cutover
(`05`), since that is the first point real DD2 staff log in.

**To switch:** provision an Entra app registration per environment (`09` §1), implement the
OIDC strategy against `src/auth/entra-mapping.ts` (already written and tested — it is the
security-critical half), populate `entraObjectId` on existing users, set
`disableLocalStrategy` except for the break-glass account, and delete
`src/auth/password-policy.ts`.

## Non-negotiable rules

These are release-blocking. Do not weaken, skip, or mark flaky-and-ignored.

1. **The public rendering layer never imports the Payload SDK.** All content access goes
   through `src/content/*`, which returns hand-written DD2 domain types — never Payload's
   generated types (`02` §11). Enforced by ESLint `no-restricted-imports` over
   `src/app/(frontend)/`, `src/components/`, and `src/blocks/`, not by convention. This is
   the entire hedge against the Payload dependency; it is cheap only if maintained from day
   one.
   _Scope note:_ `05` states this as "no file under `src/app/**`", which is unimplementable
   literally — Payload 3 mounts its admin and API as App Router routes under
   `src/app/(payload)/` that must import the SDK. That directory is exempt and holds no DD2
   rendering logic. `tests/unit/guardrails/content-boundary.test.ts` pins both the
   enforcement and the exemption.
2. **Tenant isolation is application-layer**, enforced in Payload access functions, because
   Payload owns the connection and Postgres RLS is unavailable (`02` §4.2). The adversarial
   cross-tenant test suite (`03` §6.4, `06` §2.2) is therefore the _primary guarantee_, not a
   secondary check. Reads return **query constraints, never booleans**.
3. **A `school-manager` cannot publish by any route** — admin, REST, GraphQL, or bulk op.
   Gated at both the access and hook layer.
4. **No student data enters the platform.** The PowerSchool sync is staff-only, enforced in
   five independent layers (`11` §4). The `people` collection has no fields where student
   data could land. Proven by a test seeded with student records (`11` §9).
5. **CSS logical properties only.** No `margin-left`, no `text-align: left`, anywhere — RTL
   correctness is structural. Stylelint bans physical properties and direction keywords.
6. **Zero critical/serious axe violations to merge** — on public templates _and_ both admin
   planes. The gate fails closed from Phase 0, before there is anything to gate.
7. **Alt text is required at upload** unless `isDecorative` is set — enforced by field
   validation _and_ a `beforeValidate` hook, so the API path cannot bypass it.
8. **Auto-approval is off by default and granted per named user**, never by role, tenant, or
   content type. A mixed submission queues in full (`04` §4.3).
9. **Postgres, never Mongo.** Portability is a hard requirement.

## Commands

```bash
nvm use                 # honours .nvmrc — Node 24.19.0; engine-strict blocks anything else
pnpm install
pnpm dev                # Next + Payload admin at /admin
pnpm build

pnpm typecheck
pnpm lint               # eslint + stylelint + prettier — BOTH guardrails run here
pnpm test               # vitest: unit + integration
pnpm test:unit          # includes tests/unit/guardrails — the guards' own tests
pnpm test:e2e:smoke     # playwright smoke + the failing-closed axe gate
pnpm test:a11y:components  # axe over every Storybook story, LTR and RTL — boots Storybook itself
pnpm test:perf          # lighthouse budget

pnpm storybook          # component workbench on :6006
pnpm build-storybook    # static build

pnpm db:up              # Postgres 18 on :5433 (needs docker/podman compose)
pnpm generate:types     # regenerate src/payload-types.ts from the schema
pnpm compose:pages      # one-off: every page's body words -> a Text section (idempotent)
pnpm migrate:create     # generate a reversible migration
```

## Repo layout

```
src/
  app/
    (frontend)/         public site. NEVER imports Payload — this is the guarded surface.
      sites/[hostname]/[locale]/   the rewrite target; en is unprefixed
    (payload)/          Payload's OWN mount point (admin UI + REST/GraphQL).
                        Imports @payloadcms/next by construction; exempt from the
                        boundary rule. No DD2 rendering logic goes here.
      sites/[hostname]/robots|sitemap   per-tenant /robots.txt and /sitemap.xml (proxy maps them)
    (payload)/admin-overrides.css   WCAG contrast corrections to Payload's chrome — not a theme
  proxy.ts              edge tenant + locale routing (Next 16's middleware convention)
  access/               role/tenant predicates + Payload access functions
  admin/                admin-plane React: paste prompt, school plane (SchoolPlane/,
                        SendForApproval/), approval queue + diff (Approvals/), grants
                        (Grants/), A11yPatch/ — repairs Payload's own markup until upstream
                        fixes it. Separate from components/ — this side MAY import the SDK.
  auth/                 entra-mapping.ts (unwired), password-policy.ts (interim)
  content/              THE BOUNDARY. Payload lives behind this.
    types.ts            hand-written DD2 domain types — never generated
    tenants.ts          getTenantByHostname, listActiveTenants
    navigation.ts       getNavigation — per-tenant menus (pure mapper in menus.ts)
    theme.ts            getTheme — per-tenant token overrides (mapper in theme-tokens.ts)
    settings.ts         getSettings — site name, contact, social, enabled locales
                        (mapper in site-settings.ts)
    pages.ts posts.ts events.ts people.ts documents.ts alerts.ts   (Phase 3+)
  collections/          Payload collection configs + colocated access functions
  blocks/               district-only block library (Phase 3)
  components/           shared design system; logical properties only. One directory per
                        component: Component.tsx + .module.css + .stories.tsx + index.ts
  styles/               tokens.css (design tokens) + globals.css
  lib/                  tenant resolution, paste normalizer, contrast checker, i18n
                        pipeline, mappers
.storybook/             component workbench; also the fixture set for the component axe gate
migrations/             generated from the Payload schema; reversible, tested up and down
tests/
  unit/guardrails/      tests for the guards THEMSELVES — keep these green
  a11y/                 the component axe gate — every story, LTR + RTL
                        (playwright.storybook.config.ts, needs no database)
  integration/ e2e/ fixtures/
starterDocs/            the design suite — specification, keep in sync
docs/phases/            per-phase FUNCTIONAL maps: what calls what, no rationale.
                        Written or updated as part of that phase's PR.
```

## Build order

Phases are units of _dependency_ (`05`). Do not run them out of order — each is the
dependency root for the next.

```
0 Setup + guards → 1 Tenancy/Auth → 2 Delivery + content layer → 3 Components + pages
→ 4 Approval + admin planes → 5 Content modules ─┐
                            → 6 Media/Docs/Search ┴→ 7 Localization → 8 Hardening
→ 9 Migration/Pilot → 10 Rollout/Decommission
```

Three things are nearly free at the start and expensive to retrofit across a finished
codebase. All three land in Phase 0–2, before the first component ships:
the **content-access layer**, **CSS logical properties**, and the **failing-closed axe gate**.

**Definition of done for every phase** (`05`): types clean; unit + integration + e2e passing;
zero critical/serious axe violations on public _and_ admin; RTL verified for new layout;
isolation tests green; boundary lint green; ADRs updated; add-on register reviewed.

## Test-driven development

**This project is TDD.** Write the failing test first, make it pass, then refactor. The
design suite already assumes this posture — the axe gate fails closed from Phase 0 before
any feature exists, and the adversarial isolation tests are written in Phase 1 as the
deliverable, not after it (`05`, `06`).

**TDD is mandatory** — no exceptions — for the five areas carrying 100%-intent coverage
(`06` §7), plus everything else that is a pure function of its inputs:

- Access-control and tenant-isolation functions (table-driven: role × tenant × collection)
- The publish gate — a `school-manager` cannot publish by any route
- The PowerSchool no-student-data invariant, driven from a fixture seeded with student records
- The auto-approval grant boundary — nothing auto-approves without an explicit grant
- The **paste normalizer** — the highest-value unit suite in the project; fixtures of real
  Word and Google Docs payloads come first, the normalizer second
- Utilities and mappers: tenant resolution from hostname, slug generation, recurrence
  expansion, iCal serialization, SEO/OG assembly, migration field mappers, translation
  string hashing
- Hooks: revalidation tags, COPE purge fan-out, `alt` required unless `isDecorative`

**Where test-first is the wrong tool** — say so and use the stated alternative rather than
writing a test you will delete:

| Surface                                                                | Why                                                                                                                           | Instead                                                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Custom Payload admin React views (task plane, diff viewer, block list) | Layout and interaction shape are discovered by looking at them; test-first yields brittle assertions rewritten each iteration | Build, then lock behaviour with a Playwright flow + axe assertion in the same PR — non-negotiable before merge           |
| Payload collection configs and field declarations                      | Largely declarative; asserting "this field exists" restates the schema                                                        | TDD the access functions, hooks, and validators attached to them — that is where the behaviour lives                     |
| Theme tokens, visual and typographic work                              | No meaningful failing test to write                                                                                           | Contrast validated at token level; visual regression + RTL check                                                         |
| First contact with an external API (OneRoster, Entra OIDC)             | You cannot write an honest test before seeing a real payload                                                                  | **Spike → capture the response as a fixture → delete the spike → TDD against the fixture.** No spike code reaches `main` |

The caveat that makes this stick: a TDD rule with no stated exceptions gets cargo-culted on
the surfaces it fits badly, then quietly abandoned everywhere. The table above is the
exception list; anything not on it is test-first.

**Nothing merges without its tests** (`05`). A PR that adds behaviour and no test is
incomplete, not fast.

## Styling

**Plain CSS. No Tailwind, no CSS-in-JS, no Sass.** This follows design principle 6 —
boring, mainstream technology, nothing bespoke where a standard exists — and keeps the
design system legible to whoever maintains this next.

- **Design tokens are CSS custom properties** in `src/styles/tokens.css`. Per-tenant themes
  override token values at render from the `theme` global (`02` §4.4); they never fork
  stylesheets. Per-locale typography tokens (CJK line-height, font stacks) are tokens too.
- **Component styles are CSS Modules** (`Component.module.css`) — Next's built-in scoping,
  still plain CSS syntax, no runtime. Global styles stay in `src/styles/`.
- **Logical properties only**, enforced by stylelint (non-negotiable rule 5). Use
  `margin-inline-start`, `padding-block`, `inset-inline`, `inline-size`/`block-size`,
  `text-align: start`, `float: inline-start`.
- **Contrast is validated at token level**, so a per-tenant brand palette cannot ship a
  combination that fails AA (`07` §3).
- Avoid inline `style` props for anything layout-bearing — stylelint cannot see them, which
  puts them outside the RTL guard.

## Working conventions

- **Vertical slices.** A content module is built schema → access → approval integration →
  block/template → migration mapper → tests, before the next module starts.
- **Every new block ships with a Storybook entry and an axe test in the same PR.** Blocks own
  their heading levels — an editor must not be able to produce a heading-order violation by
  reordering.
- **Migration mappers are built alongside the module they target**, not saved for the end.
- **Payload version bumps are a deliberate, separate PR** — never bundled with feature work,
  always with a full a11y and isolation run.
- Migrations are expand/contract; no destructive change without a two-step migration.
- Secrets live in platform secret stores, never the repo.

## Git

- Trunk-based with short-lived branches; every change goes through a PR and the full gate
  set. Releases are tagged; the production promote is a deliberate, approved step.
- **Never mention Claude, Claude Code, or any AI assistant in commit messages or pull
  requests.** No `Co-Authored-By: Claude` trailer, no "Generated with Claude Code" footer,
  no attribution in the body or title. Write commits and PRs as the maintainer would.

## The two design bars that drive most decisions

**Usability:** _a school manager who last logged in five months ago, attended no training,
and reads no documentation completes their task unaided._ This is measured on real DD2
staff who were not involved in the build. It rules out collection-oriented navigation, the
word "collection," draft-vs-published as a visible concept, tenant switchers, and any screen
where the primary action is ambiguous. The school plane shows **verbs, not collections**, and
every form submits with one button: **"Send for approval."**

**Approval throughput:** approve must be **one click from an inline diff**. If approving
requires opening each document, the district becomes the bottleneck, schools stop
submitting, and the sites go stale — which is the exact failure this platform exists to
prevent. Content staleness, not bad edits, is the real failure mode.

## Scope discipline

Every capability must trace to something DD2 actually does. **Finalsite usage parity, not
Finalsite feature parity.** Payload's unused capabilities are not requirements.

Deferred add-ons (`01` §4) are preserved as **seams — a permission boundary, a nullable
field, an interface — never speculative infrastructure.** Do not build the submissions
store, retention job, PII machinery, `teams` collection, portal auth collection, or PDF/UA
validator. Their attachment points already exist (`03` §4).

Out of scope entirely: mass communications, native forms in v1 (MS Forms embedded),
athletics as a structured module, PDF/UA remediation, SIS/LMS/billing, native mobile apps,
social publishing out.

**If a form would ever collect student information, stop.** That is a FERPA decision
requiring counsel, not a feature decision.

## Open items requiring a human decision

Do not resolve these in code; flag them:

- **ADA Title II compliance bracket** — likely April 26, 2028 under DOJ's April 2026 interim
  final rule, but **confirm with counsel** (`00`, `07`).
- **Title VI language-access obligation** — which locales DD2 must serve is a policy
  question for counsel and the Title VI coordinator (`08` §10).
- **Document remediation ownership** and the legacy backlog policy (`07` §5).
- **The identical-school-layouts assumption** (`01` §8) — falsified or confirmed by the
  template census (`10` §2), which should start during Phase 3, not at migration.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
