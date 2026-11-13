# 09 — Deployment & Operations

How the platform is shipped and run: CI/CD, environments, hosting, the 99.9% availability
engineering, backups/DR, monitoring, incident response, and the standing governance that
keeps the Payload dependency safe. Fully managed — no servers to administer.

## 1. Environments

| Env | Host | Data | Promotes from |
|---|---|---|---|
| **Local** | Developer machine (Docker) | Seed fixtures, `*.localhost` tenants, mocked IdP | — |
| **Preview** | Per-PR ephemeral deploy | Sanitized sample | branch push |
| **Staging** | Mirror of prod | Migrated sample / pilot data | merge to `main` |
| **Production** | Managed prod stack | Live | manual promote (tagged release) |

Config is environment-scoped; secrets live in each platform's secret store, never in the
repo. Infrastructure and Cloudflare/DNS config are captured as code where supported.

**Search indexing is production-only, and fails closed.** `SITE_INDEXING=allow` is set in
production and nowhere else. Without that exact value every site serves `Disallow: /`, a
`noindex` on every page, and no sitemap — so a new environment, or one whose config was
forgotten, stays out of search results rather than publishing a second copy of 28 school
websites with pilot data on it. Setting it is part of the production promote checklist.

**Entra ID:** separate app registrations per environment. Non-production never authenticates
against the production directory.

## 2. CI/CD pipeline

```
PR:   typecheck → lint (boundary + logical-properties) → unit → integration → build
      → e2e (full, sharded) → axe gate → Lighthouse budget* → Preview deploy
      (* and the component axe gate and dependency audit: only when the PR can affect them — `06` §3)
main: (all above) → Staging deploy → DB migration (guarded) → post-deploy smoke + a11y
rel:  tag → manual approval → Production deploy → migration → health/smoke → cache warm
```

- **DB migrations** are generated from the Payload schema, reviewed, and applied as a
  guarded, reversible step (expand/contract; never a destructive change without a two-step
  migration). Tested up and down in CI (`06` §2.2).
- **Deploys are atomic** with instant rollback (redeploy previous immutable build).
- **Frontend and backend deploy independently** (`02` §3), so an admin deploy never risks
  the public site.
- **Payload version bumps are a deliberate, separate PR** — never bundled with feature work,
  always with a full a11y and isolation run (`07` §9).

## 3. Hosting topology (managed)

| Component | Service | Notes |
|---|---|---|
| Public frontend | Vercel (or Cloudflare Pages) | SSG/ISR, edge middleware, multi-region. |
| Admin + API (Payload) | Render / Railway | Container, autoscale, health checks. |
| Database | Neon (or Supabase) | Managed Postgres, HA, PITR. |
| Object storage | Cloudflare R2 | Media + document originals; no egress fees. |
| CDN / DNS / WAF / TLS | Cloudflare | Caching, wildcard `*.district.org` TLS, DDoS/WAF. |
| Identity | Microsoft Entra ID | Staff authentication; district-managed. |
| Translation | Azure AI Translator | Metered; cached in Postgres (`08`). |
| Email | Resend | Transactional and approval notifications only. |

Ops-wise this is a low four-figure annual spend in managed services with no machine
administration. **Translation API spend is the one variable cost** — bounded by distinct
strings × locales and incurred only on change (`08` §11).

## 4. Availability engineering (the 99.9% target)

**Target:** 99.9% public-site uptime (≤ ~8h 46m/yr), achieved by **decoupling**, not by
buying enterprise SLAs on every layer.

### 4.1 The decoupling principle
Public pages are static/ISR and served from the Cloudflare edge. The database, admin, and
identity provider are **not in the public request path**. Therefore:
- Backend down → **publishing and approvals pause, serving continues.**
- DB failover → editors briefly affected, **public unaffected.**
- **Entra ID outage → staff cannot log in; public entirely unaffected.**
- Translation API down → cached translations serve; only new strings fall back to source.
- Public availability ≈ CDN availability (~99.99%), not the serial product of all services.

### 4.2 Caching & invalidation
- Pages cached at the edge with **cache tags** keyed by document id, tenant, **and locale**.
- **Publish/approve → on-demand revalidate + targeted tag purge**; the rest stays warm. COPE
  items purge every surface that renders them, in every locale.
- **Stale-while-revalidate** so an origin blip serves slightly-stale content rather than an
  error.
- **Alert bar** is a short-TTL edge fragment so emergency updates propagate in seconds
  without a rebuild — the one intentionally near-real-time element.

### 4.3 Spike absorption
A weather/closure day can drive a 100× burst. Because pages are edge-cached, the spike is
served from cache with **no origin scaling**; verified by the k6 spike test (`06` §2.6)
before cutover. **Tier 1 locale variants are pre-rendered for high-traffic pages** so a
closure day does not generate a wave of cold-locale ISR misses (`08` §5).

### 4.4 SLA posture
The stack delivers *practical* 99.9%+ for visitors. A contractual per-layer SLA is
unnecessary at this scale; the district can commit to 99.9% on the strength of the
cached-delivery design. **Publishing-plane target is 99.5%** — an editor or approval outage
is not a public incident.

## 5. Backups & disaster recovery

| Asset | Backup | RPO | RTO |
|---|---|---|---|
| Postgres | Managed automated backups + **PITR** | ≤ 5 min | ≤ 1 hr |
| Media/docs (R2) | Versioning + periodic cross-bucket copy | ~24 hr | Minutes (CDN-cached meanwhile) |
| Translation cache | In Postgres; regenerable from source at API cost | ≤ 5 min | Regenerates lazily |
| Content export | Scheduled full content/media export | ≤ 24 hr | N/A |
| Config/IaC | In Git | commit | Minutes |

- **DR runbook:** restore DB from PITR to a new managed instance → repoint backend →
  redeploy → warm cache. Public sites remain up on cached content throughout unless the
  incident is edge-wide.
- **Portability:** the scheduled export doubles as vendor-independence proof and **must be
  demonstrated import-ready once**, not merely produced (`00`).
- DR restore is **tested**, not assumed — at least once before cutover and periodically
  after.

## 6. Monitoring & observability

- **Uptime + synthetic checks** on each tenant hostname and the admin health endpoint →
  alerting + a **public status page**.
- **Error tracking** (Sentry or equivalent) on frontend and backend with source maps.
- **Structured logs** (request id, tenant id, locale) aggregated; retained per policy.
- **Core Web Vitals** field monitoring per tenant **and per Tier 1 locale**.
- **Per-tenant audit trail** (publishes, approvals, auto-approvals, deletes, user and grant
  changes) for accountability and defensibility.
- **CSI sync monitoring (`11`):** each run's summary (created, updated, hidden, dropped, errors) is logged; a dashboard history is not built. Failure alerts
  the maintainer but does not affect the site (directory serves last-known-good).
- **Translation monitoring:** API error rate, cache hit ratio, unverified strings on
  review-flagged pages, monthly spend, and an **anomalous-volume alert** (usually a bulk
  migration or an accidental corpus re-hash).

### 6.1 Operational health metrics unique to this platform

These measure whether the *workflow* is working, not whether the servers are up:

| Metric | Why it matters | Alert |
|---|---|---|
| **Approval queue depth and oldest item age** | A slow queue means schools stop submitting and sites go stale — the failure this platform exists to prevent (`04`) | Item pending > 3 business days |
| **Median approval time** | Tracked from cutover; the input to any auto-approval grant decision (`04` §4.3) | Trend review, not alert |
| **Content freshness per tenant** | Stale sites are the real failure mode, not bad edits | Tenant unchanged 90+ days |
| **Unattested document count** | Standing accessibility work queue (`07` §5) | Trend review |
| **Bulk decorative-flag usage** | A signal that alt text is being evaded (`07` §4.3) | Spike detection |

## 7. Runbooks

- **Add a tenant:** create `tenants` row (hostname within `*.district.org`) → assign users
  → seed theme/nav → done. No deploy.
- **Publish stuck / not going live:** check revalidation hook and purge logs; manual
  purge-by-tag; confirm backend health.
- **Backend/API down:** confirm public sites still serving (they should); redeploy; check DB
  health; publishing and approvals resume automatically.
- **DB incident:** managed failover or PITR restore per DR; public unaffected; comms via
  status page for editors.
- **Entra ID outage / misconfiguration:** public sites unaffected. Use the break-glass local
  admin (`02` §7) to reach the platform; verify app registration, group claims, and secret
  expiry. **Rotate the break-glass credential after any use and record it.**
- **Traffic surge:** verify edge hit ratio; ensure alert-bar fragment healthy; no action if
  cache is serving (by design).
- **Emergency alert path:** select a template, fill variables, publish — all Tier 1 locales
  publish with verified wording (`08` §8.2). Free-text alerts require an extra confirmation
  and carry a machine-translation disclosure.
- **Approval coverage during absence:** designate temporary coverage before extended leave;
  confirm the second `district-admin` is active. **Summer and school closures are the
  predictable gap** (`04` §5).
- **Translation API failure:** cached translations continue serving; new strings fall back
  to source and retry on next revalidation. No public impact; no action usually required.
- **CSI sync failure (`11`):** confirm the public directory is still serving (it
  will — last-known-good); check the source's reachability and credentials; re-run
  (`POST /api/staff-sync/run`). No data
  is wiped on failure.
- **Credential rotation** (CSI, when its transport has credentials; Azure Translator; Entra client secret): rotate in
  source system + secret store; verify with a manual run. **Calendar the expiry dates** —
  silent secret expiry is the most common avoidable outage in this stack.
- **Security event:** rotate secrets, review WAF/logs, patch dependency, post-mortem.

## 8. Dependency governance — the Payload reassessment trigger

**This section exists because a dependency risk that nobody is watching becomes a crisis
rather than a decision** (`00`).

**Standing rules:**
- Payload version **pinned**; repo **mirrored** to the district GitHub org.
- Plugin surface stays minimal (`02` §2). Adding one requires weighing swap cost.
- The **content-access layer boundary** is CI-enforced (`06` §2.8).
- **Annual verification that the content export is import-ready.**

**Reassessment triggers — any one prompts a documented review, not an automatic migration:**

1. No Payload security release for **6 months** while CVEs are outstanding.
2. A Next.js major version unsupported by Payload for **one quarter** past its release.
3. A licence change on a version DD2 would need.
4. Public signal that 3.x/4.x maintenance is ending without a viable upgrade path.
5. **Annual review regardless** — a calendar item with a named owner.

**On trigger, the review documents:** current risk, cost to fork and self-maintain, cost to
migrate behind the content-access layer, and a recommendation. Options remain open precisely
because the boundary was maintained.

## 9. Change management & governance

- Trunk-based with short-lived branches; every change through PR + gates (`06`).
- Releases tagged; production promote is a deliberate, approved step.
- **Rollback is always one redeploy away.** Migrations reversible by design.
- Post-incident reviews are blameless and produce a tracked action item.
- Dependency updates on a schedule, with the a11y and isolation gates catching regressions.
- **Add-on register reviewed at each release** (`01` §4.4) — unrequested for a year means
  dead, not pending.
