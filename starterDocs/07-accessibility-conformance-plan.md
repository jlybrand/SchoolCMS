# 07 — Accessibility Conformance Plan

How WCAG 2.1 AA is *guaranteed by construction* rather than chased by audit. This is the
platform's core differentiator and a live legal obligation.

**Standard:** WCAG 2.1 Level AA for all web content and both authoring interfaces.
**Deadline:** DOJ's April 2026 interim final rule moved entities under 50,000 population
and special district governments to **April 26, 2028** (larger entities to April 26, 2027).
The substantive WCAG 2.1 AA requirement is unchanged. **Confirm DD2's bracket with counsel**
— and note that private ADA litigation and state obligations were never subject to the
deadline at all.

## 1. Strategy: four layers, not one audit

| Layer | What it prevents | Where |
|---|---|---|
| **1. Structural** | Inaccessible *templates* | Block library with block-owned semantics (§3) |
| **2. Authoring-time** | Inaccessible *content* | Constrained rich text, paste normalization, required alt (§4) |
| **3. Human review** | Everything the machine can't judge | Approval queue on every school change (`04` §4) |
| **4. CI + audit** | Regression over time | axe gate, manual AT, per-release conformance report (§7) |

**Layer 3 is unusual and valuable.** Because no school-originated change reaches the public
unreviewed (`04`), DD2 has a human who understands AA seeing every edit. Most districts have
no such gate. It is the reason this platform can make a stronger conformance claim than its
component library alone would justify.

## 2. What is in scope

- All public templates and rendered content, in **every enabled locale**.
- **Both authoring interfaces** — the school task plane and the district admin (`04` §6).
  DD2 staff may author using assistive technology; an inaccessible admin excludes them from
  their own jobs. This is the most commonly skipped requirement in CMS projects.
- Documents surfaced through the platform (§5).
- Third-party embeds surfaced on DD2 pages (§6).

## 3. Layer 1 — structural conformance

Every block ships with:

- **Block-owned heading levels.** A block decides its own heading semantics from its
  position in the page outline. An editor cannot produce a heading-order violation by
  reordering blocks, because they never choose heading levels.
- **Required accessibility fields** enforced at the schema level, not the form level:
  accessible names on interactive blocks, `title` on embeds, alt on meaningful images.
- **No colour-only meaning.** Severity, status, and error states carry text or icon plus
  text.
- **Visible focus** on every interactive element, meeting 2.4.11 focus appearance.
- **Contrast baked into theme tokens.** Per-tenant palettes are validated against AA
  contrast at token level, so a school cannot pick a brand colour that fails.
- **CSS logical properties only** — RTL correctness is structural, verified from the first
  component (`08` §7).
- A Storybook entry and an axe test in the same PR (`06` §2.4).

**Reduced motion** honoured globally; no autoplaying media; no content that flashes.

## 4. Layer 2 — authoring-time conformance

### 4.1 The paste problem

**This is DD2's single largest source of inaccessible content today**, and the reason it
persists is that it looks fine. School staff compose agendas and notices in Word or Google
Docs and paste them in. What arrives is `<span style="font-family:Calibri;mso-...">` soup,
headings that are bold 14pt text rather than `<h2>`, lists made of literal `•` characters
and manual line breaks, and occasionally a layout table.

To a sighted reader it renders identically to correct markup — which is exactly why it
survives visual review. To a screen-reader user there is no structure at all: no headings to
navigate by, no list semantics, no reliable reading order.

### 4.2 The paste normalizer

Normalization happens **on paste**, not on render. Sanitizing at render preserves the
garbage in the database and re-inflicts the problem on every future consumer, migration, and
export.

| Input | Behaviour |
|---|---|
| Inline styles, classes, `mso-*`, font/colour declarations | Stripped entirely |
| Elements outside the allowlist (`p`, `h2`, `h3`, `strong`, `em`, `a`, `ul`, `ol`, `li`) | Unwrapped to text content |
| Lines beginning `•`, `-`, `*`, `1.`, `a)` | **Reconstructed as real `<ul>`/`<ol>` items** — the highest-value transform, since agendas are largely lists |
| Smart quotes, non-breaking spaces, empty spacer paragraphs, doubled breaks | Normalized quietly |
| Bold short lines that look like headings | **Offered, never assumed** — one prompt: *"These lines look like headings. Mark them as headings?"* |
| Tables | Rejected with a plain-language explanation and an alternative |
| Images embedded in the paste | Rejected; the user is directed to the upload flow so alt text is captured |

The heading prompt is deliberately a question rather than a heuristic. Auto-promotion is
unreliable enough to cause harm, and the prompt requires no understanding of what a heading
*is* — only a yes.

### 4.3 Alt text at the point of upload

Required at upload, not caught at review (`04` §2.5). If alt text were a review-time catch,
the district would end up writing alt text for 28 schools — the work would relocate, not
disappear.

- Prompt: *"Describe this image for someone who can't see it."*
- **"This image is decorative"** is the honest escape hatch; selecting it is recorded, and
  bulk-decorative use surfaces on the district dashboard as a signal worth checking.
- Enforced by field validation **and** a `beforeValidate` hook, so the API path cannot
  bypass it (`03` §2).

### 4.4 Constrained rich text

A fixed Lexical element allowlist (§4.2). No arbitrary HTML, no inline styles, no font or
colour controls. Editors cannot express a formatting idea the design system hasn't already
made accessible. This is a feature, and it should be explained to communications staff as
one.

### 4.5 Structured content over prose

Meeting dates, staff records, events, and documents are typed fields rendered by tested
templates — not free text describing the same information. **The most reliable way to
guarantee accessible output is to reduce how much of it is authored at all.**

## 5. Documents

**Documents are remediated before upload. The platform records status; it does not
remediate** (`01` §4.4).

- Upload requires an explicit attestation checkbox with plain-language text, recorded with
  actor and timestamp (`03` §2).
- `remediationStatus`: `attested` | `not-attested` | `not-applicable`.
- `not-attested` documents appear on the district dashboard as a standing work queue.
- **Validation cannot remediate.** A checker tells you a PDF fails; someone still has to fix
  it in Acrobat or an equivalent tool. Automated validation is a deferred add-on (`01`
  §4.4) that would run as a nightly batch job, never in the upload path.

**Policy questions this design surfaces but does not answer**, and which DD2 should settle:

1. Who remediates? (Originating staff, a central role, or a vendor.)
2. What happens to the legacy backlog carried from Finalsite?
3. What is the standing rule for new documents — is HTML preferred over PDF by default?

**The strongest available answer to (3) is "prefer HTML."** Meeting agendas, board minutes,
newsletters, and notices are the bulk of school PDF uploads and are all better served as
structured content (§4.5). The document library should hold things that are genuinely
documents — state forms, handbooks, board policy — which is a much smaller pile.

## 6. Third-party embeds

Embeds are DD2's accessibility obligation even though DD2 did not build them.

- **Domain allowlist only** (Microsoft Forms, approved schedule providers, approved video
  hosts). No free-form iframe source (`02` §9).
- Every embed requires a `title` and a visible fallback link so the content is reachable if
  the frame fails or is inaccessible.
- **Require a current VPAT/ACR from any embedded vendor** before allowlisting, and record
  it. Athletics schedule providers and form vendors are the common failure points.
- Video requires captions; the platform does not generate them, and the policy should say so
  explicitly.

## 7. Layer 4 — testing, audit, and evidence

Mechanics live in `06`; the conformance framing is here.

- **CI axe gate failing-closed from Phase 0** — before any feature exists — so the bar is
  never "added later" (`05`).
- Scope grows as components land; every new block registers its axe test in the same PR.
- **Manual AT per release:** keyboard-only pass on public templates and the five school
  tasks; NVDA + VoiceOver smoke on core templates, task forms, and the approval queue;
  200%/400% zoom and reflow; contrast spot-checks; reduced-motion.
- **At least one screen-reader pass in a non-English locale**, including Arabic for RTL.
- **Per-release conformance report** recording automated results, manual AT findings, and
  open defects — the evidence base for the VPAT/ACR DD2 can publish, and the record that
  matters if a complaint arrives.

## 8. Accessibility statement & feedback

Required by the Title II rule's spirit and by ordinary good practice:

- A per-tenant accessibility statement page describing conformance status, known
  limitations, and how to request an accessible alternative.
- **A working feedback route** with a named owner and a response-time commitment. An
  unmonitored form is worse than none.
- Documented alternative-format request process for anything not yet remediated.

## 9. Governance

- **Named owner:** the district ADA/accessibility coordinator holds conformance
  accountability; the maintainer holds implementation.
- **Remediation targets:** critical/serious defects blocking; moderate defects tracked with
  a stated resolution window.
- **Approval-queue reviewers are the front line.** Whoever holds `district-admin` must be
  able to recognise bad alt text, misused headings, and vague link text. This is a training
  requirement for two or three people — far more tractable than training 50.
- **Annual re-audit** and a re-audit on any major dependency upgrade.
- **Regression protection:** dependency updates run the full a11y gate; a Payload or Next.js
  major upgrade requires a manual AT pass before release.

## 10. Acceptance criteria

1. Zero critical/serious axe violations on every public template, in every Tier 1 locale,
   LTR and RTL.
2. Zero critical/serious axe violations on both admin planes.
3. Keyboard-only completion of all five school tasks and of approve-from-queue.
4. Manual AT sign-off on core templates in English and one RTL locale.
5. Alt text cannot be omitted on a non-decorative upload by any route.
6. Pasted Word content produces clean semantic markup, verified against the fixture corpus
   (`06` §5).
7. Every embedded third-party vendor has a recorded, current VPAT.
8. A published per-tenant accessibility statement with a monitored feedback route.
9. A conformance report exists for the release, suitable as the basis for a VPAT/ACR.
