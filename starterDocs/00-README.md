# DD2 Website Platform — Software Design Documentation

**Project:** District-owned website platform to replace Finalsite Composer
**Owner:** DD2
**Status:** Design — v2.1 (August 2026)
**Platform:** Payload CMS 3 (pinned) + Next.js App Router + PostgreSQL

**Revision history:**
- v1.0 (July 2026) — Payload CMS 3, broad Finalsite feature parity
- v2.0 (Aug 2026) — custom application, no CMS framework; scope reduced to observed usage
- **v2.1 (Aug 2026) — returns to Payload 3, retains every v2.0 scope reduction**

---

## What this is

A district-owned, accessibility-native web platform serving one district domain and 27
school subdomains (28 tenants) from a single codebase and deployment. It replaces the
rented Finalsite Composer CMS.

The platform is built on **Payload CMS 3** (TypeScript, Next.js-native, code-first schema)
with a Next.js App Router front end, PostgreSQL, and a CDN-fronted static/ISR delivery
model that keeps the public sites online independently of the editing backend.

## Why v2.1 exists — read this first

v2.0 specified a bespoke Next.js application with no CMS framework. **The scope analysis
behind it was correct and is retained in full.** The *stack* conclusion was reversed for
one reason: for a platform that must outlive its author, being the sole maintainer of a
bespoke CMS is a larger long-term risk than depending on a mature MIT framework.

**What v2.0 got right and v2.1 keeps** — the scope reductions, which is where most of this
project's risk reduction actually lives:

- School layouts are identical → fixed page types for schools, block composition for the
  district only (`04`).
- One power user → the district admin need not be self-explanatory; the school interface
  must be.
- Every school change is reviewed → request-to-publish workflow (`04` §5).
- Portals, forms, athletics, and the PDF/UA pipeline are **seams, not subsystems** (`01`
  §4–5).
- Meeting agendas are constrained rich text with aggressive paste normalization, not
  pasted Word markup (`07` §4).
- Localization is a rendering concern, not an authoring obligation (`08`).

**What changed back:** Payload provides the admin UI, auth scaffolding, drafts and
versioning, the publish gate, access control, media handling, and migrations. The
application builds on those rather than reimplementing them.

## The Payload dependency — risk and hedge

Payload was acquired by Figma in June 2025. The MIT licence and self-hosting are
unaffected and 3.x continues to ship.

**Payload cannot begin charging for code already published under MIT** — that licence is
irrevocable for released versions. The real risk is quieter: maintenance slows, Next.js
compatibility drifts, and DD2 ends up maintaining a fork of a large framework it did not
write.

**Six standing rules make that risk survivable** (detailed in `02` §11, operationalized in
`09` §8):

1. **A content-access layer.** Frontend components never call Payload directly. They call
   `src/content/*` functions that return DD2 domain types. Payload lives behind that
   boundary. This is the single difference between a swappable and an unswappable system,
   and it costs a few days of discipline.
2. **Postgres, never Mongo.** Data stays in plain relational tables readable by anything.
3. **Pin the version; mirror the repository** into the district GitHub organisation.
4. **Minimal plugin surface** — multi-tenant and SEO. Every plugin is a swap cost.
5. **A written reassessment trigger** with a calendar reminder (`09` §8), so drift is
   noticed deliberately rather than discovered urgently.
6. **The scheduled content export must be import-ready**, and proven so once — not merely
   produced.

## How to read this suite

Read in order. Each document is self-contained but assumes the ones before it.

| # | Document | Answers |
|---|----------|---------|
| 00 | This document | *Why* this shape, and what the governing principles are |
| 01 | [Project Scope & Requirements](01-project-scope.md) | *What* are we building, for whom, and where are the boundaries? |
| 02 | [System Architecture](02-system-architecture.md) | *How* does it fit together — stack, tenancy, delivery, availability, security? |
| 03 | [Data Model & Access Control](03-data-model-access-control.md) | *What* are the collections, relationships, and permission rules? |
| 04 | [Authoring Model & Approval Workflow](04-authoring-model-approval-workflow.md) | *Who* edits what, and how does a change reach the public? |
| 05 | [Build Order & Roadmap](05-build-order-roadmap.md) | In *what sequence* do we build, and what depends on what? |
| 06 | [Testing Strategy](06-testing-strategy.md) | How do we *prove* it works and stays working? |
| 07 | [Accessibility Conformance Plan](07-accessibility-conformance-plan.md) | How do we *guarantee* WCAG 2.1 AA — by design, not by audit? |
| 08 | [Localization Pipeline](08-localization-pipeline.md) | How is content served in many languages without a translation vendor? |
| 09 | [Deployment & Operations](09-deployment-operations.md) | How is it *run* — CI/CD, environments, monitoring, backups, DR, dependency governance? |
| 10 | [Migration & Cutover](10-migration-cutover.md) | How do we move off Finalsite *without a service gap*? |
| 11 | [Integration: PowerSchool Staff Sync](11-integrations-powerschool.md) | How does the staff directory pull from PowerSchool — *staff only, never students*? |

## Design principles

1. **Own the data and the code.** Open formats, standard Postgres, MIT dependencies, full
   content and media export. No proprietary lock-in for core function.
2. **Accessibility is structural, not remedial.** Conformance is a property of a small,
   fixed block library enforced in CI, plus a human review gate on every school-originated
   change. Content is born conforming because it is difficult to author otherwise.
3. **Public availability is decoupled from the backend.** Visitors are served cached
   static/ISR pages from the edge. An admin or database outage pauses *publishing*, never
   *serving*.
4. **One codebase, 28 tenants.** Shared components and syndication (COPE); per-tenant
   branding and scoped content. No per-site forks.
5. **Delete before you build.** Every capability must trace to something DD2 actually
   does. Finalsite parity is not a goal; Finalsite *usage* parity is.
6. **Boring, mainstream technology.** No clever, no bespoke where a standard exists.
7. **Stay swappable.** The content-access layer is not optional architecture — it is what
   makes principle 6 safe to rely on.

## Non-negotiable constraints

- **Standard:** WCAG 2.1 Level AA. Documents are remediated before upload (`07` §5) — the
  platform records status, it does not remediate.
- **Availability target:** 99.9% for public sites (`09`).
- **Scale:** ~400,000 visitors/year across 28 tenants. Low; not the design driver.
- **Tenant isolation:** the invariants in `03` §6.4 must always hold; release-blocking.
- **No student data** enters the platform from PowerSchool or anywhere else (`11`).
- **Compliance timing:** DOJ's April 2026 interim final rule moved entities under 50,000
  population and special district governments to **April 26, 2028**; larger entities to
  April 26, 2027. DD2's bracket is almost certainly 2028 — **confirm with counsel**.
