# 01 — Project Scope & Requirements

## 1. Vision

Replace the rented Finalsite Composer CMS with a district-owned platform that (a) supports
what DD2 editors actually do rather than what Composer can do, (b) makes WCAG 2.1 AA
conformance a property of the system rather than a manual cleanup task, and (c) serves 28
sites reliably at a fraction of the recurring cost.

The design driver is **correctness, accessibility, and low maintenance burden** — not
scale, and not feature parity with a commercial CMS.

## 2. Stakeholders & personas

| Persona | Reality today | Implication for design |
|---|---|---|
| **District communications** (power user) | The only heavy user. Composes pages, manages branding, controls district-wide messaging. Builds 1–2 pages/month. | Full cross-tenant admin, section-based composition, syndication, alert control. Density over hand-holding. |
| **School website manager** | School staff (secretary, office manager, occasionally a teacher). Website is the last thing on their mind. Infrequent logins, little training, low confidence in the current tool. | Task-shaped forms, not a CMS. No publish rights — changes are submitted for approval. Must be usable with zero retained training. |
| **District administrator (IT / ADA coordinator)** | Accountable for accessibility and access control. | Approval queue visibility, freshness dashboard, audit trail, per-tenant a11y status. |
| **Public visitor** (parent, student, staff, community) | Needs fast, accessible information on any device, in English or Spanish. | Static/ISR edge delivery, AA conformance, server-rendered translation. |
| **Assistive-technology user** | Screen reader / keyboard / low-vision access equal to others. | First-class a11y, tested with real AT. Applies to the *admin* as well as the public site. |
| **Developer / maintainer** | Currently one person. Must be replaceable. | Small legible codebase, documented decisions, mainstream substrate, no bespoke abstractions where a standard exists. |

**The two-plane consequence:** district and school users have opposite needs. The design
serves them with two distinct interfaces over one data model (`04`), rather than one
compromise admin.

## 3. In scope — functional modules

Derived from **observed DD2 usage**, not from the Composer feature list.

1. **Pages** — fixed page types with typed fields for schools; block composition for
   district (`04` §4). Draft/versioning and rollback. *School-level composition is a
   deferred add-on (§4.1), not a removed capability — the blocks already exist.*
2. **Approval workflow** — school changes are submitted, reviewed by district, then
   published. The core workflow of the platform (`04` §5).
3. **News & announcements** — categorized posts, per-tenant and district-wide feeds.
4. **Calendars & events** — per-tenant and aggregated calendars; iCal export; recurring
   events. Athletics schedules are events with a category, not a separate module.
5. **Meeting dates & agendas** — dates are structured event fields; agenda bodies are
   constrained rich text pasted from Word or Google Docs. **Paste normalization is a
   first-class feature** (`07` §4), because pasted document markup is DD2's single largest
   source of inaccessible content today.
6. **Directories** — staff/faculty directories, **sourced from PowerSchool via a read-only
   staff sync** (staff only; no student data — see `11`).
7. **Document library** — uploads with category, visibility, and a remediation attestation
   (`07` §5). The platform records accessibility status; it does not remediate.
8. **Media library** — images with derivative generation, **required alt text enforced at
   upload**, focal point.
9. **Alert bars** — site- or district-wide banners with scheduling and severity; edge
   fragment with short TTL (weather/closure use case).
10. **Content syndication (COPE)** — author once on the district tenant, reference from
    many school tenants. Single source of truth for news, events, and alerts.
11. **Navigation & menus** — per-tenant primary/utility/footer navigation.
12. **Search** — per-tenant and cross-tenant site search (Postgres FTS).
13. **SEO controls** — per-page slug/title/meta/OG, sitemap.xml, robots, redirects.
14. **Localization** — **multiple languages** via an owned translation pipeline (`08`).
    Locale set is configuration, not code. No per-field manual translation obligation, and
    no per-locale authoring burden on staff. Right-to-left scripts are supported if the
    locale set requires them (`08` §6).
15. **Theming & branding** — per-tenant logo, palette, typography tokens over one shared
    design system.
16. **Staff-visible content** — a `visibility: staff` flag on pages and documents, gated by
    district SSO. Deliberately minimal (see §4).

## 4. Deferred add-ons — designed for, not built

Three capabilities are **deliberately not in v1 but explicitly preserved as add-ons.** They
are not "out of scope"; they are "not yet, and nothing built now forecloses them."

**The discipline that makes this work:** preserve the *seam*, do not build speculative
infrastructure. A seam is a permission boundary, a nullable field, or an interface. It is
not a half-finished feature. Anything that would require redesigning v1 to add later is
called out below.

### 4.1 School-level page composition

**Status: ENABLED 2026-11-04 (Jason), at "level B".** Schools edit, add, remove and reorder the
simple components (Text, Button, Cards, Accordion, Divider); the district's components (Columns,
News feed, Video, Section menu) stay the district's, and inside the district's columns a school
writes by the same rules. All pages become composed. Enforced by `schoolLayoutGate` against the
stored layout on every route; the approval queue lists section changes. The analysis below is
kept as written.

**Status as first written: nearly free to enable.** Block-based composition is already built for the
district (`03` §3) — the block library, templates, accessibility tests, and rendering all
exist. Enabling it for schools is a **field-level access change plus editor guardrails**,
not a new subsystem.

| To enable | Work |
|---|---|
| Allow `school-manager` to compose (adopted 2026-11-04) | Access-function change |
| Restrict which blocks schools may use | Block-level access filter |
| Editor guardrails and guidance | Admin UX work — the real cost |
| Approval queue handling for block changes | Already covered — diffs are content-agnostic |

**Two things to weigh before flipping it on**, because they are policy questions rather
than technical ones:

1. **Accessibility posture weakens.** Fixed page types make inaccessible output
   structurally hard to author. Blocks make it *possible* — a school could produce a
   heading-order or reading-order problem that individually-tested blocks cannot prevent.
   The approval gate (`04` §5) still catches it, but the burden shifts from the system to
   the reviewer.
2. **The "28 identical sites" assumption ends.** Once schools compose freely, layouts
   diverge, and the template census (`10` §2), the QA matrix, and design-system changes all
   become per-site concerns rather than district-wide ones. This is the larger cost and it
   is permanent.

**Recommended trigger:** enable per tenant, on request, after that school's manager has
demonstrated the fixed types are genuinely insufficient — not district-wide by default.

### 4.2 Native forms

**Status: seam is clean; cost is real but bounded.** v1 embeds Microsoft Forms (§5). If DD2
later wants forms inside the platform:

| To enable | Work |
|---|---|
| `forms` + `submissions` collections | `@payloadcms/plugin-form-builder` |
| Accessible field templates | Component work, axe-tested like any block |
| Receipt email | Resend is already wired |
| Spam protection, rate limiting | Turnstile/honeypot |
| **Retention and redaction policy + job** | The genuinely new work |
| **PII handling review** | Policy, not code |

**Nothing in v1 blocks this.** The only design constraint carried now is that a page can
embed a form by URL, which stays useful either way.

**Do not build now:** the submissions store, retention job, or PII machinery. Those exist
to serve a data-collection surface that does not yet exist, and building them speculatively
means maintaining and security-reviewing an unused PII store.

**Recommended trigger:** form count exceeds ~10, or a form needs to write into platform
content, or MS Forms proves inadequate on accessibility. **Hard stop:** if any form would
collect student information, that is a FERPA decision requiring counsel — not a feature
decision (§5).

### 4.3 Staff portal (already minimal)

DD2 has one district staff portal holding links to handbooks, professional development, and
staff documents — some already public. Served by a `visibility: staff` flag on pages and
documents, gated by the same Entra ID session used for the admin.

**Not built:** a separate portal auth collection, audience/group matching, portal user
management, or school-level portals. If those are needed later, the flag is where they
attach.

**Rule of thumb:** if a document needs access control strong enough to justify group
membership and audit, it belongs in SharePoint, where the district already has permissions
and lifecycle management.

### 4.4 Add-on register

| Add-on | Cost to enable later | Cost of preserving the option now | Blocked by anything in v1? |
|---|---|---|---|
| School page composition | Low (access change + admin UX) | **Zero** — already built for district | No |
| Native forms | Medium (plugin + retention + policy) | **Zero** — embed seam is useful anyway | No |
| Portal audiences/groups | Medium | **Zero** — flag is the attachment point | No |
| Athletics as a module | Medium (new collections) | **Zero** — events carry the category | No |
| In-platform PDF/UA validation | Medium (batch job, not request-path) | **Zero** — attestation field already records status | No |

**This register is reviewed at each phase gate** (`05`). An add-on that nobody has asked for
in a year should be considered dead, not pending.

| Gate review | Requested since last review | Marked dead |
|---|---|---|
| Phase 4 close (2026-10-27) | None | None — the oldest is under a year from this design (Aug 2026) |

## 5. Explicitly out of scope

- **Messages / mass communications** — email blasts, SMS, voice, robocalls, emergency mass
  notification. DD2 uses a separate service; this is not part of the Finalsite contract
  being retired. Transactional email (auth, notifications) is **in** scope.
- **Native forms in v1** — DD2 currently runs ~4 forms, none touching student data. These
  are served by **Microsoft Forms** (already licensed, submissions stay in the district M365
  tenant, vendor accessibility conformance reports available), embedded via a titled iframe
  with a visible fallback link. **This is a deferred add-on, not a permanent exclusion**
  (§4.2). **If a form would ever collect student information, stop — that is a FERPA
  decision requiring counsel, not a feature decision.**
- **Athletics as a structured module** — no teams/rosters/results schema in v1. Schedules
  are events with a category; existing third-party schedule providers continue to be
  embedded. Deferred add-on (§4.4). Embedded widgets remain DD2's accessibility obligation
  (`07` §6).
- **PDF/UA remediation pipeline** — documents are remediated *before* upload. The platform
  records status and surfaces a district-visible list of unattested documents (`07` §5).
  Batch validation is a deferred add-on (§4.4); remediation itself is never in scope,
  because validation cannot remediate.
- **Enrollment / SIS, gradebook / LMS, tuition & billing, lunch/payment systems.**
- **Native mobile apps** — sites are responsive; a native app is a separate project.
- **Social-media publishing out** to third parties (social embeds *in* are in scope).

**One integration is in scope:** a read-only **PowerSchool staff sync** for the staff
directory (`11`). It pulls **staff records only — never student data**. This is not a
general SIS integration.

## 6. Non-functional requirements

| Category | Requirement |
|---|---|
| **Accessibility** | WCAG 2.1 AA for all templates and shipped content. Zero critical/serious axe violations to merge. The **admin interfaces are also in scope** — DD2 staff may author using assistive technology. See `07`. |
| **Availability** | 99.9% public-site uptime; publishing plane may target 99.5%. Public delivery decoupled from backend (`02`, `09`). |
| **Performance** | Core Web Vitals "good" (LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1) at p75 on 4G/mid device. Cached pages TTFB < 200ms from edge. |
| **Scalability** | Absorb a 100× traffic spike (weather/closure) via CDN with no origin scaling. ~400k visitors/yr baseline. |
| **Security** | OWASP ASVS L2 posture; SSO via district Entra ID; least-privilege roles; **tenant isolation enforced in Payload access functions and proven by an adversarial test suite on every build** (`03` §6.4); encrypted at rest and in transit. |
| **Privacy** | FERPA-aware: no student PII anywhere in the platform. The PowerSchool integration pulls staff data only — enforced in depth (`11` §4). |
| **Maintainability** | Mainstream stack a competent Next.js developer can pick up. Typed schema-as-code; documented architectural decisions with rationale; no bespoke systems where the framework provides one. Onboarding < 2 days. **The content-access layer (`02` §11) is mandatory** — it is what keeps the CMS replaceable. |
| **Portability** | Standard Postgres (never Mongo), open formats, full content and media export that is **import-ready and proven so once**. No single-vendor dependency for core function. |
| **Usability** | A school manager who last logged in five months ago, attended no training, and reads no documentation completes their task unaided. This is the *actual* bar — see §7.4. |
| **Observability** | Structured logs, uptime and error monitoring, per-tenant audit trail, content freshness dashboard, public status page. |
| **Compliance timing** | Conformant before DD2's ADA Title II deadline — **likely April 26, 2028** under DOJ's April 2026 interim final rule for entities under 50,000 population and special district governments. Confirm bracket with counsel. The WCAG 2.1 AA standard itself is unchanged. |

## 7. Success criteria (acceptance)

1. All 28 tenants live on the platform with content migrated and validated.
2. Automated and manual accessibility audit passes WCAG 2.1 AA on every template, on the
   school and district admin interfaces, and on a sampled set of real pages.
3. Public sites sustain a simulated 100× spike from cache with no downtime.
4. **A school manager with no training and no documentation completes each of these
   unaided:** add a meeting date, post an announcement, edit page text, upload an image
   with alt text, upload a document. Measured on real DD2 staff, not proxies.
5. **Tenant isolation invariants (`03` §6.4) proven** — adversarial cross-tenant read and
   write attempts denied for every role, across REST, GraphQL, admin, and bulk operations.
6. **No student data invariant proven** (`11` §9) — release-blocking.
7. **Every enabled locale** renders correctly on every template, with correct `lang` and
   `dir` attributes, working font coverage for each script, and an accessible language
   switcher. Verified with a screen reader in at least one non-English locale.
8. Finalsite contract retired with zero public-facing outage during cutover.
9. Full content and media export demonstrated (portability proof).

## 8. Assumptions

- 28 tenants (1 district + 27 schools); count may grow — the model must not hardcode it.
- **All school layouts are materially identical.** Verified by the template census (`10`
  §2) before Phase 3. If this proves false at scale, the composition model must be
  revisited before building school page types.
- Content volume is moderate; media in low tens of GB; traffic is low.
- The district is on Microsoft 365 and can provision an Entra ID app registration for
  OIDC.
- The district owns its domains and DNS (Cloudflare) and can set a wildcard record.
- School staff will not receive, retain, or seek training. Design accordingly.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Key-person dependency** | Mainstream framework a competent Next.js developer can learn from public documentation; documented architectural decisions; small application surface on top of Payload. **The primary reason v2.1 returned to Payload** (`00`). |
| **Payload maintenance slows or stalls** | MIT licence caps the downside (pinned versions run indefinitely); repository mirrored to the district org; minimal plugin surface; content-access layer bounds the switching cost (`02` §11); written reassessment trigger with a calendar reminder (`09` §8). |
| **Tenant leakage from an access-control mistake** | Query-constraint reads; adversarial cross-tenant tests as every role on every build (`03` §6.4, `06`). **Load-bearing — this suite is the primary isolation guarantee, not a secondary check.** |
| **Approval queue becomes a bottleneck** | One-click approve from an inline diff; auto-approve for low-risk typed fields; a designated second approver (`04` §6). If district review is slow, schools stop submitting and sites go stale. |
| **Content staleness** (the real failure mode, not bad edits) | Per-tenant freshness dashboard; ingest from systems staff already use rather than asking for re-entry; structured meeting dates rather than PDF uploads. |
| **No upstream security patches for the application layer** | Dependency scanning in CI; minimal plugin surface; SSO removes credential handling entirely. |
| **Scope creep back toward a general CMS** | Every proposed capability must trace to observed DD2 usage (`00` principle 5). Seams, not features. Payload's unused capabilities are not requirements. |
| **Migration data loss / format drift** | Dry-run migrations, checksum verification, parallel run before cutover (`10`). |
| **Accessibility regressions over time** | CI gates plus a human review gate on every school-originated change (`07`). |
