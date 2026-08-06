# 08 — Localization Pipeline

How the platform serves content in many languages without a translation vendor, without a
per-field translation obligation on staff, and without translations going stale.

**Governing rule:** translation is a *rendering concern*, not a *content modelling*
concern. No translated content is authored, stored per field, or maintained by DD2 staff.
Source content changes; translations regenerate.

## 1. Why not per-field localization

The obvious design — a `locale` column or a translations table per content table — was
rejected. It requires staff to author every field N times, it doubles the admin surface,
and it fails in exactly the way that matters: DD2 staff struggle to keep *English* content
current (`01` §2), so translated fields would go stale immediately. **A Spanish page
showing last year's calendar is a language-access failure with a veneer of compliance.**

The pipeline below produces translations that cannot drift from source, because they are
derived from it.

## 2. Locale tiers

| Tier | Locales | Treatment |
|---|---|---|
| **Source** | `en` | Authored. The only language anyone edits. |
| **Tier 1** | `es` (Spanish), `zh-Hans` (Simplified Chinese), `ko` (Korean), `pt` (Portuguese), `ar` (Arabic) | Pre-rendered for high-traffic pages, per-locale glossary, font stack tested, in the QA matrix (`06`), screen-reader verified in at least `es` and `ar`. Emergency alert templates human-verified (§7). |
| **Tier 2** | Any additional locale enabled in `settings.enabled_locales` | Generated on demand, machine-only, labelled as machine translation. No pre-render, no glossary obligation, not in the QA matrix. |

**Adding a Tier 2 language is a configuration change**, not a migration or a build change.
This is what makes "as many as possible" affordable: the translation cache is keyed by
*string*, not by page, so a new locale adds cache entries as visitors actually arrive
rather than multiplying the page count up front.

Promoting a locale from Tier 2 to Tier 1 means adding a glossary, testing the font stack,
adding it to the QA matrix, and commissioning verified emergency templates — a deliberate
act, not a config flag.

## 3. Relationship to Payload's built-in localization

Payload provides field-level, per-locale storage with a human authoring each value. It is
**not** the primary mechanism here, for reasons that are independent of the stack:

- **Nobody would fill it in.** Six locales means six times the authoring burden landing on
  staff who already treat the website as an afterthought (`01` §2).
- **It stores derived data, so it drifts.** Edit the English and the Spanish silently stays
  wrong. The hash-keyed pipeline cannot drift — change the source and the stale translation
  is simply no longer looked up.
- **It does not scale to the long tail.** Enabling 20–30 locales would put that many values
  on every localized field in the admin and the document.
- **It does not cover most strings.** Navigation labels, button text, date formats, and
  component chrome never live in Payload documents, so the pipeline is required regardless.
- **No cross-tenant dedup.** Shared boilerplate across 28 near-identical sites would be
  translated 28 times instead of once.

**Where it is used.** Payload localization is enabled on exactly two surfaces, because it
provides one thing worth having — a real translator's editing interface with locale
switching, versioning, and permissions:

1. `alertTemplates` — the pre-translated emergency library (§7.2).
2. Pages and documents flagged `requiresTranslationReview` (§7.1).

Enabled for **Tier 1 locales only**, so the admin stays uncluttered for everything else.

**Resolution order at render:**

1. Payload localized value — if the document is verification-flagged and the locale is
   Tier 1. Human-verified; always wins.
2. `translation_overrides` — a district correction to machine output.
3. `translations` cache — machine output keyed by source hash.
4. Translation engine on miss → store, then use.
5. Source text — fallback.

**Caution:** Payload's localized fields interact with drafts and versions in ways that get
confusing — a version is a snapshot across locales, so a Spanish correction and an English
edit can collide. Keeping verification-flagged content to a small set keeps this
manageable.



## 4. Pipeline

```
Source content (en)
   │
   ├─ extract translatable strings at render/build time
   │     (title, rich text blocks, alt, SEO fields, nav labels, UI chrome)
   │
   ├─ normalize + hash each string  ──►  source_hash
   │
   ├─ resolve per (source_hash, locale):
   │     0. Payload localized value  (verification-flagged content only — §3)
   │     1. translation_overrides    (human correction — always wins over machine)
   │     2. translations             (cached machine output)
   │     3. cache miss ──► Azure AI Translator ──► store ──► use
   │
   └─ render locale variant as a static/ISR page under /{locale}/
```

**Key properties:**

- **Translations are not tenant-scoped.** Twenty-eight near-identical sites share
  enormous amounts of boilerplate ("Upcoming Events", "Staff Directory", navigation
  labels). Each distinct string is translated once per locale for the entire district.
- **Cache invalidation is automatic.** Change the English source and its hash changes, so
  the old translation is simply no longer looked up. Nothing goes stale; nothing needs
  purging.
- **The engine is swappable.** Azure AI Translator is the default (100+ languages, already
  inside the district's Microsoft relationship, so no new vendor agreement or DPA). The
  pipeline depends on an interface, not on Azure.
- **Cost is bounded by distinct strings × locales**, incurred once per change — not per
  page, per visitor, or per build.

## 5. Rendering & routing

- Locale variants live under a path prefix: `/es/...`, `/ar/...`. **Not** a cookie-varied
  response — one URL, one cached artifact, so edge caching stays intact.
- English is served at the unprefixed path.
- **No automatic redirect on `Accept-Language`.** It breaks caching, surprises returning
  visitors, and strands anyone whose browser locale differs from their preference. Offer a
  persistent switcher; remember the choice in a cookie that influences *link generation*,
  never the response body.
- Tier 1 locales are pre-rendered for high-traffic pages (homepage, calendar, alerts,
  contact); everything else is on-demand ISR and cached at the edge thereafter. First
  visitor pays a few hundred milliseconds; every subsequent visitor gets an edge hit.
- `hreflang` alternates emitted for every enabled locale plus `x-default`.
- Sitemaps include locale variants.

## 6. Accessibility requirements (release-blocking)

These are WCAG criteria, not polish:

- **`lang` on `<html>`** set to the rendered locale (3.1.1 Language of Page).
- **`lang` on inline foreign-language content** — school names, proper nouns, and glossary
  terms that remain in English inside a translated page (3.1.2 Language of Parts). The
  glossary (§6) is what makes this mechanical rather than manual.
- **`dir="rtl"`** on `<html>` for Arabic and any future RTL locale.
- **Language switcher** lists each language **in its own script and language** — Español,
  简体中文, 한국어, Português, العربية — with `lang` on each option. Never flag icons; never
  "translate this page" as the only affordance.
- Machine-translated Tier 2 content carries a visible, translated disclosure.

## 7. Script-specific handling

### Right-to-left (Arabic)
- **CSS logical properties throughout the component library from Phase 3** —
  `margin-inline-start`, `padding-inline`, `text-align: start`, `inset-inline`. No
  `margin-left`, no `text-align: left`, anywhere. This is nearly free if done from the
  first component and expensive to retrofit across the whole library.
- Directional icons (arrows, chevrons, back/next) mirror; non-directional icons
  (logos, search, calendar) do not.
- Mixed-direction content (English school names, phone numbers, dates inside Arabic prose)
  uses `bdi` where needed.
- Layout is tested in RTL as part of the visual regression suite, not spot-checked.

### CJK (Simplified Chinese, Korean)
- **Font weight is a real performance concern.** Full CJK webfonts run to several
  megabytes and will break the LCP budget in `01` §6. Approach: a system font stack for
  CJK locales by default, with optional subset webfonts loaded per-locale via
  `unicode-range` only if the district requires brand typography in those languages.
- `line-break: strict` and `word-break: normal`; do not apply Latin word-breaking rules.
- Line-height needs adjusting for CJK glyph height — a per-locale token in the theme, not a
  global change.
- Text expansion/contraction: CJK is typically shorter than English, Arabic and Portuguese
  longer. Components must not assume string length; test at 130% and 70%.

### Numbers, dates, currency
`Intl.DateTimeFormat` and `Intl.NumberFormat` with the active locale. Never hand-format
dates. Note Arabic-Indic numeral preferences are a locale option, not an assumption.

## 8. Content tiers & human review

Machine translation is the default. Two exceptions.

### 7.1 High-stakes pages
A `requires_translation_review` flag on `pages` and `documents`, set for content with legal
or safety consequence: enrollment, registration, discipline, special education, Title IX,
health, and transportation.

- The page publishes in English immediately.
- Tier 1 locale variants **hold** until a human verifies the translation.
- Until verified, the locale variant serves the English content with a translated notice
  and the district's language-assistance contact.
- Verification is recorded in `translation_overrides` with `corrected_by` and
  `corrected_at`, and appears in the audit trail.

This keeps the review burden on the small set of pages where it matters, rather than on
every staff bio.

### 7.2 Emergency alerts — pre-translated templates

**The most important part of this document.** A closure notice cannot wait for a
translator at 5am, and machine-translating an emergency instruction is the highest-risk
translation on the site.

- Maintain an `alert_templates` library: roughly 15–20 canned messages (school closed,
  two-hour delay, early dismissal, shelter-in-place, shelter-in-place lifted, bus route
  cancelled, campus reopened, event postponed) with named variables for school name, date,
  and time.
- Each template is **human-verified once, up front, in all Tier 1 locales** and stored in
  `alert_template_translations`.
- At incident time the district selects a template and fills variables; every Tier 1 locale
  publishes instantly with verified wording.
- Free-text alerts remain available for novel situations and machine-translate with a
  visible disclosure.

**Cost: one afternoon of a translator's time, once.** Value: the emergency communication
path — the one with real safety consequence — is never machine-translated under pressure.

## 9. Glossary & overrides

- **`translation_glossary`** — per-locale do-not-translate list: school names, mascot
  names, staff names, PowerSchool-sourced job titles, district programme names, and
  acronyms. Passed to the translation engine as a glossary and used to emit `lang`
  attributes on untranslated spans (§5).
- **`translation_overrides`** — a human correction keyed by `(source_hash, locale)`,
  permanently taking precedence over machine output. Editable one-click from the rendered
  page by a district admin.
- Overrides survive engine changes and re-translation. They are the mechanism by which
  quality improves over time without anyone maintaining a parallel content tree.

## 10. What this pipeline does not cover

- **Documents.** Machine translation does not apply to uploaded PDFs. Any document that
  matters for language access needs a separately-uploaded translated version, tagged by
  locale. This is a content policy, not a system capability (`07` §5).
- **Embedded third-party content.** Microsoft Forms, schedule providers, and video embeds
  render in their own language handling. Where a translated equivalent exists, link it.
- **User-submitted content.** Not applicable — the platform has no public submission
  surface (`01` §5).
- **Legal sufficiency.** Meeting Title VI language-access obligations is a district policy
  question informed by LEP population data. This pipeline provides capability; it does not
  determine which languages DD2 is obliged to serve or to what standard. **Confirm the
  obligation with counsel and the district's Title VI coordinator.**

## 11. Operations

- **Backfill job:** enabling a locale queues translation of the existing string corpus for
  Tier 1; Tier 2 populates lazily on visit.
- **Monitoring:** translation API error rate and latency; cache hit ratio; count of
  unverified strings on `requires_translation_review` pages; monthly API spend.
- **Failure handling:** a translation API outage serves cached translations normally; only
  *new or changed* strings fall back to source text, and they retry on the next
  revalidation. **A translation outage is never a public outage** (`02` §8).
- **Cost control:** alert on anomalous string volume (typically a bulk migration or an
  accidental re-hash of the corpus). Cap per-run translation volume.

## 12. Build placement

Built in two stages (`05`):
- **With the component library (Phase 3):** logical properties, `lang`/`dir` plumbing,
  locale routing, the switcher, and font strategy. These are structural and must not be
  retrofitted.
- **As its own slice (later phase):** extraction, hashing, cache, engine client, glossary,
  overrides, backfill job, alert template library, and review workflow.
