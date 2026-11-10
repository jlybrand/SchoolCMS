# 10 — Migration & Cutover

How 28 tenants move from Finalsite Composer to the owned platform **without a public-facing
outage**. The governing rule: build in parallel, validate, then flip DNS behind the CDN per
tenant — never a big-bang switch.

## 1. Principles

1. **Parallel run, not cutover-in-place.** Finalsite stays live and read-only until each
   tenant is validated on the new platform.
2. **Per-tenant, wave-based.** Blast radius is one school at a time.
3. **Every migration is a dry run first.** No production cutover until a checksum-verified
   dry run passes for that tenant.
4. **URLs are preserved.** A redirect map prevents broken links and protects SEO and the ADA
   obligation — dead links are access failures.
5. **Migration improves content; it does not preserve its defects.** Legacy markup is
   re-normalized, not carried across (§5).
6. **Reversible.** DNS can revert to Finalsite instantly if a post-cutover check fails.

## 2. The template census — do this first

**Start during Phase 3, not at migration** (`05`). Everything in this design rests on the
assumption that school layouts are materially identical (`01` §8). The census tests it.

Across all 28 sites, record:
- How many **distinct page layouts** exist, and how many are actually in use.
- Which schools deviate, and whether the deviation is substantive or cosmetic.
- Which pages are district-authored versus school-authored.

**Outcomes:**
- *Assumption holds* → proceed as designed: fixed page types for schools, composed pages for
  district.
- *A handful of outliers* → handle with two or three extra fixed page types. Cheap.
- *Widespread divergence* → revisit before Phase 5. School-level composition moves from
  deferred add-on (`01` §4.1) to v1 scope, with the accessibility and maintenance
  consequences that entails.

The district apex tenant is expected to be the exception; one non-uniform site out of 28 is
what the district's components exist for.

## 3. Inventory & assessment (per tenant)

Before migrating a tenant, produce an inventory:

- Page tree + URLs; news/events volume; **document library with current accessibility
  status**; navigation; theme/brand assets; existing redirects; embeds and their sources.
- **Forms** — confirm the count and purpose. Each becomes a Microsoft Forms embed (`01`
  §5). **Verify none collects student information**; if one does, stop and escalate to
  counsel before migrating it anywhere.
- **Staff portal content** — which items are genuinely non-public, and whether anyone relies
  on that. Genuinely sensitive material goes to SharePoint, not back into scope (`01` §4.3).
- **Language content** — any existing Spanish or other translated pages, and whether they
  are current. Stale translations are not migrated; the pipeline regenerates from English
  (`08`).
- **Staff directory is NOT inventoried** — it is seeded from PowerSchool (`11`). Capture only
  supplementary bios/photos worth preserving into CMS-owned fields.
- Flag content that is unused or duplicated. Migration is the cheapest opportunity to drop
  cruft the district will otherwise carry for another decade.

## 4. Extraction from Finalsite

- Export via available Finalsite export/APIs, with structured HTML scraping of the rendered
  site as a fallback for content that does not export cleanly.
- Capture: page content and structure, media/document binaries, metadata, and the **full URL
  list** for the redirect map.
- Store raw exports immutably — the audit and rollback reference.
- **Capture a corpus of real pasted content** while extracting. This becomes the paste
  normalizer's fixture set (`06` §5) and is far more representative than synthetic Word
  payloads.

## 5. Transform & load

Per-module **migration mappers**, built during their phase (`05`), convert Finalsite content
to the target schema (`03` §8):

- **Composer page → `pages`**: its words as Text sections, plus the district's components where
  the page needs them. Every page is composed (2026-11-04).
- **Rich text → re-normalized through the paste pipeline** (`07` §4). Legacy `<span>` soup,
  bold-as-heading, and manual bullet lists are converted to clean semantic markup rather than
  carried across. **This is where migration actively improves accessibility instead of
  importing a decade of debt.** Heading candidates are flagged for editor confirmation, not
  auto-promoted.
- **Meeting agendas → `events.agendaBody`**, same normalization.
- News → `posts`; events → `events`; athletics → `events` with `category: athletics`; files
  → `media` + `documents`; alerts → `alerts`.
- **Staff directory is NOT migrated** — seeded from the PowerSchool sync (`11`) so it starts
  authoritative and current. Finalsite-only supplementary fields (bios, photos) import into
  the CMS-owned fields the sync preserves.
- **Media:** alt captured from source where present; **flagged for editor completion where
  missing.** No silent empty alts on meaningful images.
- **Documents:** loaded with `remediationStatus: not-attested` unless evidence exists
  otherwise. The district work queue (`07` §5) is the backlog, made visible rather than
  assumed away.
- Everything loads as **drafts**. Nothing is public until reviewed and published on the new
  platform.

## 6. Verification (gate before cutover)

Per tenant, automated + human:

- **Automated:** content/asset **checksum and count reconciliation** (export vs. loaded);
  broken-link scan; **redirect-map coverage** (every old URL resolves); axe pass on migrated
  pages; Tier 1 locale render check on a sample; document status recorded for every file.
- **Human:** editor spot-review of top pages, navigation, and directories; visual/brand check
  against the old site; **heading-promotion confirmations resolved**.
- **Accessibility:** migrated pages clear the same AA gate as new content (`07`).

**No tenant proceeds to cutover until its verification passes.**

## 7. Cutover procedure (per tenant)

1. Freeze content edits on the Finalsite tenant (short window); apply last deltas.
2. Publish validated content on the new platform (still on a preview host).
3. Ensure the **redirect map** is loaded so legacy URLs 301 to new paths.
4. **Flip DNS** for `school.district.org` (behind Cloudflare; TLS already wildcarded — no
   cert wait). Low TTL set in advance.
5. Warm the edge cache, **including Tier 1 locale variants** for high-traffic pages.
6. Run **post-cutover smoke + a11y checks**.
7. Monitor error rate, 404s (redirect gaps), and Core Web Vitals for the tenant.
8. **Rollback trigger:** if checks fail, revert DNS to Finalsite (instant) and fix forward.

## 8. Waves

| Wave | Tenants | Purpose |
|---|---|---|
| **Pilot** | 1–2 schools (varied complexity) | Prove end-to-end migration, editor UAT, and a11y on real content. Go/no-go gate. |
| **Rollout waves** | Remaining schools in batches | Repeatable, monitored; one batch fully validated before the next. |
| **District (apex)** | `district.org` | Most complex and syndication-heavy; do once schools are stable. |

**Editor readiness is different here.** The usability bar is *no training required* (`01`
§6), so UAT is a test of the system, not preparation of the staff. Run task-based UAT
against the pilot with school managers **who were not involved in the build** (`06` §6). If
they cannot complete the five tasks unaided, that is a defect, not a training gap.

**Approval-queue readiness:** the district must be ready to review submissions from every
newly cut-over tenant. Queue capacity, not migration throughput, is the practical limit on
wave size.

## 9. Decommission

- Keep Finalsite **live read-only** until *all* tenants pass post-cutover checks and a
  monitoring soak period elapses.
- Archive raw Finalsite exports plus a full platform **content/media export**, and **prove
  the export is import-ready** (`00`, `09` §5).
- Confirm redirect coverage holds site-wide; retire remaining vendor DNS.
- **Terminate the Finalsite contract.** Confirm it does not bundle services still in use —
  DD2's mass notification runs on a separate service (`01` §5), but verify before signing.
- Savings begin the next billing cycle.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Layout uniformity assumption is wrong | **Template census in Phase 3** (§2), before rollout depends on it. |
| Content/format loss in export | Immutable raw exports + checksum reconciliation; scrape fallback. |
| Broken inbound links / lost SEO | Comprehensive redirect map; broken-link scan as a gate. |
| Inaccessible legacy content carried over | Mappers re-normalize through the paste pipeline; migrated content hits the same a11y gate; documents enter the attestation queue rather than passing silently. |
| Alt text missing at scale | Flagged for editor completion, surfaced as a work queue — never silently emptied. |
| A migrated form collects student data | Form inventory (§3) checks this explicitly before anything moves. |
| Approval queue overwhelmed by rollout | Wave size limited by review capacity, not migration speed (§8). |
| Editor unfamiliarity at flip | Design bar is training-free; UAT with uninvolved staff proves it (`06` §6). |
| Cutover failure | Parallel run + instant DNS rollback + low TTL. |
| Big-bang blast radius | Per-tenant, wave-based cutover — one school at a time. |
