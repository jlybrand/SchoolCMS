# Phase 3 — Component library and pages

How the rendering foundation works: heading ownership, the layout primitives, the token
contrast checker, and the two accessibility gates that sit under all of it.

Phase 3 lands across several PRs. This document is written as each one merges.

| Slice                                      | State                                                     |
| ------------------------------------------ | --------------------------------------------------------- |
| Component foundation                       | **Landed** — §1–§7 below                                  |
| Paste normalizer                           | Landed early (PR #6); not yet wired to an editor — see §8 |
| `pages` collection (schema, access, gates) | **Landed** — §9–§12 below                                 |
| Page templates and rendering               | **Landed** — §16                                          |
| Block library                              | **Batch 1 complete** — §17–§20                            |
| Constrained rich text (Lexical)            | **Landed** — §13, §15                                     |
| Navigation                                 | **Landed** — §21                                          |
| Theme, SEO, sitemap                        | Not started                                               |

---

## 1. File inventory — component foundation

### Added

| File                                           | Job                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `src/lib/contrast.ts`                          | Contrast maths, the pair checker, and `REQUIRED_CONTRAST_PAIRS`          |
| `src/components/Heading/levels.ts`             | `HeadingLevel`, `clampHeadingLevel`, `nextHeadingLevel`, level constants |
| `src/components/Heading/Heading.tsx`           | Renders `h1`–`h6`; visual size is a separate prop                        |
| `src/components/Section/Section.tsx`           | Named landmark + its heading; no heading → no landmark                   |
| `src/components/SkipLink/SkipLink.tsx`         | Bypass blocks (2.4.1); exports `MAIN_CONTENT_ID`                         |
| `src/components/VisuallyHidden/`               | Announced, not painted                                                   |
| `src/components/Container/`                    | Reading measure and gutters — the only owner of both                     |
| `src/components/Stack/`                        | Vertical rhythm from `gap`                                               |
| `src/components/Link/`                         | Underlined always; `rel` follows `target`; new window announced          |
| `src/components/**/*.stories.tsx`              | One story file per component — the fixtures the axe gate walks           |
| `.storybook/main.ts`, `.storybook/preview.tsx` | Storybook config; `lang`/`dir` toolbar globals                           |
| `playwright.storybook.config.ts`               | Second Playwright config — Storybook server, no database                 |
| `tests/a11y/storybook.spec.ts`                 | axe over every story, LTR + RTL, plus the fail-closed check              |
| `tests/unit/contrast.test.ts`                  | 18 tests over the maths and the checker                                  |
| `tests/unit/tokens.test.ts`                    | 24 tests — every contrast pair, every locale typography block            |
| `tests/unit/components/*.test.tsx`             | 37 tests over component semantics (jsdom)                                |
| `tests/helpers/render.tsx`                     | `renderComponent` — sets `lang`/`dir` on the document, cleans up         |
| `tests/helpers/tokens.ts`                      | Parses `src/styles/tokens.css` for the token suite                       |

### Changed

| File                           | Change                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `src/styles/tokens.css`        | Adds `--color-border-strong`, `--focus-ring-color-inverse`, `--measure-wide`; corrects three stale ratio comments |
| `src/styles/globals.css`       | `main` keeps `padding-block` only; measure and gutters move to `Container`                                        |
| `.../[locale]/layout.tsx`      | Renders `SkipLink` as the first element in `<body>`                                                               |
| `.../[[...segments]]/page.tsx` | Renders through `Container` / `Stack` / `Heading` / `Link`; `main` carries `MAIN_CONTENT_ID`                      |
| `tests/e2e/smoke.spec.ts`      | Adds the skip-link behaviour test                                                                                 |
| `vitest.config.ts`             | Unit include accepts `.tsx`                                                                                       |
| `.github/workflows/ci.yml`     | New `components` job — the Storybook axe gate                                                                     |
| `package.json`                 | Storybook 10.5.8, `@storybook/nextjs-vite`, `@storybook/addon-a11y`, Testing Library; three new scripts           |

---

## 2. Heading levels

```
page template                  Heading level comes from position, never from a field
  │  <Heading level={PAGE_TITLE_LEVEL}>          → h1
  ▼
  Section level={BLOCK_HEADING_LEVEL}            → h2  + <section aria-labelledby>
    │
    └─ Section level={nextHeadingLevel(2)}       → h3  + <section aria-labelledby>
         │
         └─ … nextHeadingLevel saturates at 6
```

`Heading` renders `h{clampHeadingLevel(level)}` and takes an independent `size`, so a deeply
nested `h4` can still read as a section title without anyone reaching for a bigger element.

**Why props and not React context.** Blocks render as server components, and server
components have no context — `useId` is unavailable for the same reason, which is why
`Section` takes `headingId` from its caller rather than generating one. Templates already
hold stable ids (a page slug, a block id).

**What the conformance claim rests on.** "An editor cannot produce a heading-order violation
by reordering blocks" is true because no block exposes a level as a field, not because
anything validates the outline at render. A developer passing the wrong level is a code
review problem; an editor cannot reach it at all.

## 3. Landmarks

`Section` emits `<section aria-labelledby={headingId}>` **only** when it has a heading.
Without one it renders a plain `<div>`. An unnamed `<section>` still appears in a screen
reader's landmark list as an unlabelled "region", which on a composed page means several
indistinguishable entries.

The name is a reference (`aria-labelledby`), not a copy (`aria-label`), so it cannot drift
from the visible heading — including after Phase 7 translates headings at render.

## 4. Token contrast

```
tokens.css  ──parsed by──▶  tests/helpers/tokens.ts
                                    │  resolve(token) → value
                                    ▼
REQUIRED_CONTRAST_PAIRS ──▶ checkContrastPairs() ──▶ ContrastFailure[]
   (src/lib/contrast.ts)              ▲
                                      │
Phase 4: the `theme` global resolves the SAME pairs from a tenant's overrides
```

One function answers the question in both places. Two implementations would eventually
disagree, and the generous one would be the one that let a failing palette ship.

Everything the checker cannot evaluate is a failure, never a skip: a missing token
(`unresolved-token`), a `var()` indirection or a colour with alpha (`unevaluable-colour`).
`contrastRatio` throws rather than returning a number for an unparseable colour.

The token suite also asserts that **every colour token appears in some pair**. Three are
excluded by name, each for a stated reason (`src/lib/contrast.ts`): the two surfaces are only
ever the background half of a pair, and `--color-border` is a decorative hairline outside
1.4.11. Interactive boundaries use `--color-border-strong`, which is checked.

Two tokens were added because a pair failed rather than the other way round:

- `--color-border-strong` (3.56:1 on surface) — `--color-border` scores 1.44:1, fine for a
  separator, not for anything a user operates.
- `--focus-ring-color-inverse` — the default ring scores **1.4:1 against a brand fill**. The
  first focusable element on every page is the skip link, which is brand-filled.

Three ratio comments in `tokens.css` were also wrong (`15.9:1` for a pair that is 17.9:1, and
so on); they now match what the suite computes.

## 5. The two accessibility gates

| Gate                   | Runs on                      | Where                                                             | Needs                 |
| ---------------------- | ---------------------------- | ----------------------------------------------------------------- | --------------------- |
| Public axe gate        | Rendered pages               | `tests/e2e/*.spec.ts` (`playwright.config.ts`)                    | Postgres + Next build |
| **Component axe gate** | Every story, LTR **and** RTL | `tests/a11y/storybook.spec.ts` (`playwright.storybook.config.ts`) | Storybook only        |

The component gate is driven from Storybook's own `/index.json`, so a new story is in the
gate the moment it exists — a hand-maintained list would omit exactly the component someone
forgot about. It asserts `stories.length > 5` first: an empty index would otherwise report
conformance for zero components. Both gates carry a **fail-closed test** that injects an
`<img>` with no `alt` and asserts axe reports it.

**Both runs use one axe.** The a11y addon runs axe inside the preview on every story render;
the spec runs axe from Playwright. Two instances in one frame is not slow-but-correct — axe
refuses outright ("Axe is already running") and which one wins depends on render timing. The
spec therefore passes `a11y.manual:!true` as a URL global, standing the addon down for CI
while leaving the automatic in-panel check intact during development.

**RTL** is the same story set re-run with `direction:rtl;locale:ar`, which the preview
decorator puts on `<html>` — the only place the `:root:lang()` typography tokens match.

**Why axe does not run in the unit tests.** jsdom has no layout, so the rules that matter most
here — contrast, focus appearance, anything geometric — cannot run at all. Component unit
tests assert semantics (element, role, accessible name, level); everything visual is checked
in Chromium.

## 6. Commands

```bash
pnpm storybook               # dev server on :6006
pnpm build-storybook         # static build
pnpm test:a11y:components    # the component axe gate (boots Storybook itself)
pnpm test:unit               # includes the token and component suites
```

## 7. Dependency note

`@storybook/nextjs-vite` pulls `vite-tsconfig-paths` → `tsconfck`, which peers
`typescript@^5` while this repo is on 6.0.3. `pnpm peers check` reports it; it is a range-lag
warning from a transitive dev tool, not a runtime constraint. (The `esbuild` warning in the
same output predates this work — it comes from Vitest's own Vite.)

## 8. Open threads for the rest of Phase 3

- **The paste normalizer is not wired to anything.** `src/lib/paste-normalizer.ts` and its
  fixtures landed in PR #6; `payload.config.ts` still calls a bare `lexicalEditor()`. The
  constrained rich-text slice connects them.
- **No token gallery story.** Reading token values in the browser needs client-side
  `getComputedStyle`, which is the one thing in this PR that would have required a client
  component. The contrast suite enforces the palette; a gallery would only make it visible.
- **`Container` and `Stack` take no `className`.** Deliberate — a `className` escape hatch is
  how the logical-properties guardrail gets bypassed one component at a time. If a block
  genuinely needs a variant, it goes in the component as a named prop.

---

## 9. File inventory — the `pages` collection

### Added

| File                                     | Holds                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/lib/slug.ts`                        | `slugify`, `isReservedSlug`, `buildPagePath`, `splitPagePath`                        |
| `src/access/pages.ts`                    | `canPublish`, `canComposePages`, the four access functions, `PUBLIC_PAGE_CONSTRAINT` |
| `src/collections/Pages.ts`               | The collection config                                                                |
| `src/collections/hooks/publish-gate.ts`  | `publishGate`, `composedPagesAreDistrictOnly`                                        |
| `src/collections/hooks/page-slug.ts`     | `deriveSlugFromTitle`, `uniqueSlugWithinParent`                                      |
| `src/content/pages.ts`                   | `getPageByPath`, `listPagePaths` — behind the boundary                               |
| `tests/unit/slug.test.ts`                | 25 cases                                                                             |
| `tests/unit/access/pages.test.ts`        | 41 cases                                                                             |
| `tests/unit/access/publish-gate.test.ts` | 16 cases                                                                             |
| `tests/unit/access/page-slug.test.ts`    | 15 cases                                                                             |

### Changed

| File                                         | Change                                                              |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `src/content/types.ts`                       | `Page`, `PageType`, `FIXED_PAGE_TYPES`                              |
| `src/access/predicates.ts`                   | `relationshipIdOf` — alias of `tenantIdOf` for non-tenant relations |
| `src/payload.config.ts`                      | Registers `Pages`, and `pages: {}` with the multi-tenant plugin     |
| `tests/helpers/payload.ts`                   | Four page fixtures spanning status × visibility × tenant            |
| `tests/integration/tenant-isolation.test.ts` | Invariant 5, plus invariants 1 and 4 extended to `pages`            |

## 10. The publish gate — two layers, and why

`school-manager` cannot publish by any route (CLAUDE.md rule 3, `03` §6.4 invariant 5). Two
independent enforcement points, because one is a refactor away from being none:

| Layer                                   | Sees                                 | Catches                                                    |
| --------------------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| `pagesCreateAccess`/`pagesUpdateAccess` | The incoming request `data`          | The direct attempt — fails early, before any write         |
| `publishGate` (`beforeChange`)          | The write merged over the stored doc | Bulk operations, partial updates, any future payload shape |

Both treat `publishAt` as publishing. A scheduled publish defers the transition rather than
cancelling it, so a gate that ignored it would let a school-manager publish by waiting.
`publishAt` is _additionally_ district-only at field level.

What the gate deliberately does **not** block: a school-manager editing a page that is
already live. That lands as a `draft`-status write against a published original — a new
version awaiting approval (`04` §5), not a publish. Blocking it would make live pages
uneditable by the people who maintain them.

**Hooks run even under `overrideAccess`.** A publish with no actor at all is therefore
refused, since "nobody" is not a role that may publish. This surfaced in the test fixtures,
which now create pages as the district admin rather than as no one — the gate stayed strict
and the fixtures grew an actor. Anything that publishes programmatically later (the Phase 4
approval transition, a scheduled-publish job) needs to run as an actor who may publish.

## 11. Slugs and paths

`deriveSlugFromTitle` fills the slug in from the title so an editor never has to know what a
slug is. **The title is used only on create** — renaming a live page must not move its URL,
because that breaks inbound links and the redirect map assembled in `10` §6. Moving a page
is a deliberate edit to the slug itself.

`uniqueSlugWithinParent` enforces uniqueness per **(tenant, parent, slug)**. Payload's
field-level `unique` cannot express this: two schools may both have `/about`, and so may two
parents within one school. A `null` parent queries as `{ parent: { exists: false } }` rather
than omitting the clause — omitting it would let a top-level `/about` collide with a nested
`/handbook/about`.

**Paths are walked, not stored.** `getPageByPath('/about/staff')` runs one indexed query per
segment. Denormalizing a `path` column would buy a single-query lookup and cost a cascade:
renaming one slug would have to rewrite every descendant, and a missed cascade leaves rows
whose stored path disagrees with their position — a silent wrong-page bug, and a cached one
(`02` §5). These queries never run per visitor (`02` §5), so the cheaper failure mode wins.

## 12. What `pages` does not have yet

| Absent            | Arrives with                                                                    |
| ----------------- | ------------------------------------------------------------------------------- |
| `layout` (blocks) | The block library. `pageType: composed` is already selectable and already gated |
| `seo` group       | `plugin-seo` — hand-rolling one now would mean deleting it later                |
| Page templates    | Landed — see §16. Fixed-type pages render title + body; blocks still pending    |

`body` was absent when this collection first landed and arrived with the constrained editor
in §13. The block array is still deliberately unmodelled: declaring its shape before the
block library exists would be the speculative modelling `03` §4 warns against.

---

## 13. Constrained rich text — the editor allowlist

`07` §4.4 states this as a product decision: an editor cannot express a formatting idea the
design system has not already made accessible. `src/lib/editor.ts` is that decision as code,
and `tests/unit/editor.test.ts` is what stops it decaying.

### What is enabled

`paragraph`, `heading` (h2/h3 only), `bold`, `italic`, `link`, `unorderedList`,
`orderedList`, plus `toolbarFixed`. That last one is presentation, not a content capability:
fixed rather than floating, because the usability bar is a school manager who logs in twice a
year and needs to _see_ the controls.

Headings stop at h2. `h1` is the page title, rendered by the template through
`PAGE_TITLE_LEVEL` — a body `h1` would give the page two.

Set as the **global** editor in `payload.config.ts`, not per field. A field that had to opt
in to the constraint is a field someone can forget to opt in.

### The triage table, and why it exists

The realistic threat to this control is not someone widening it on purpose. It is a Payload
upgrade shipping a new Lexical feature that nobody notices — and `09` §2 makes version bumps
their own PR, which does not read as a policy change.

So `TRIAGED_FEATURES` lists **every** feature the package exports with a verdict, and the
test fails until a new one is triaged. Each denial carries a reason, because a denial without
one is indistinguishable from an oversight. `align`, `indent`, `underline`, `strikethrough`
and `textState` are the substantive exclusions; `upload`, `relationship` and `blocks` are
denied because they belong to other governed flows.

A second test asserts the editor's element set equals the paste normalizer's
`ALLOWED_ELEMENTS`. They are the same `07` §4.2 rule at two layers — what an author can
_type_ and what survives a _paste_ — and divergence means one of them is wrong.

### The Lexical -> DD2 mapper

`src/content/rich-text.ts` maps editor state to hand-written domain nodes
(`RichText` in `src/content/types.ts`). Nothing downstream sees Lexical, which is what keeps
a CMS swap at one file rather than every template (`02` §11).

**It never throws.** It runs over content authored years apart, including migrated Finalsite
pages (`10` §5) and pages written before the editor was constrained. A node it cannot
understand becomes nothing, because a build that dies on one bad page takes 28 sites with it.

What it drops rather than rescues, and why:

| Input                          | Result                     | Reason                                                                     |
| ------------------------------ | -------------------------- | -------------------------------------------------------------------------- |
| `h1`                           | Dropped                    | Demoting to `h2` would silently move content into a hierarchy nobody chose |
| Strikethrough, underline marks | Text kept, styling dropped | The words are the content; the styling was never authorable                |
| Anchor with no `href`          | Unwrapped to text          | Unfocusable and unannounced while still looking clickable                  |
| Empty or whitespace paragraph  | Dropped                    | Word pastes use them as spacing, which the design system owns              |
| Unknown node type              | Skipped, siblings kept     | Forward compatibility with whatever Payload does next                      |

Nested lists are preserved rather than flattened — agendas nest, and flattening turns two
levels of meaning into one.

### Still open

**The paste normalizer is still not wired to the editor.** `src/lib/paste-normalizer.ts` and
its Word and Google Docs fixtures have been complete since PR #6; what is missing is the
Lexical paste handler that calls it and the heading-promotion prompt (`07` §4.2). That is
client-side admin React, which per CLAUDE.md's TDD exception table is built first and locked
with a Playwright flow plus an axe assertion in the same PR — a different kind of work from
the pure functions above, and the reason it is a separate slice.

## 14. The authenticated admin session in e2e

Prerequisite for that slice, and for every admin-plane flow after it. Added ahead of the
paste handler because none of those flows can be locked with a Playwright run without a
session to run them in.

### Added

| File                                 | What it does                                                         |
| ------------------------------------ | -------------------------------------------------------------------- |
| `tests/e2e/support/admin-session.ts` | reads the credentials, fills Payload's login form, lands in `/admin` |
| `tests/e2e/admin-session.spec.ts`    | tests the session harness itself — three specs, all `@smoke`         |

### Changed

| File                       | Change                                                      |
| -------------------------- | ----------------------------------------------------------- |
| `.github/workflows/ci.yml` | `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` on the `e2e` job |
| `.env.example`             | both variables documented under Authentication              |

### Where the credentials come from

`scripts/seed.ts` (Phase 2) creates a district-admin only when both `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD` are set, and ships no default. Unchanged by this slice. The `e2e` job
now supplies its own pair inline, alongside the `PAYLOAD_SECRET` that was already there; the
`lighthouse` job does not, because it audits public pages only.

`.env` supplies them locally, per developer, opt-in.

### Present / absent behaviour

| Environment           | Credentials set | Behaviour                                    |
| --------------------- | --------------- | -------------------------------------------- |
| CI (`process.env.CI`) | yes             | specs run                                    |
| CI                    | no              | `adminCredentials()` **throws** at file load |
| Local                 | yes             | specs run                                    |
| Local                 | no              | `test.skip` — a missing local opt-in         |

The asymmetry is the point: absent credentials locally are a developer who has not opted in,
while absent credentials in CI mean the gate stopped covering the admin plane and would
otherwise still report green.

### The three specs

| Spec                       | Asserts                                        |
| -------------------------- | ---------------------------------------------- |
| seeded admin reaches admin | login succeeds and lands on `/admin`           |
| unreachable without one    | anonymous `/admin` redirects to `/admin/login` |
| wrong password             | a bad password stays on `/admin/login`         |

The second and third exist so the first cannot pass vacuously — an `/admin` open to everyone,
or a helper that types nothing, would satisfy the first alone. The wrong-password spec makes
exactly one attempt: `users` sets `maxLoginAttempts: 5` with a 10-minute lock.

### Locators, and the hydration retry

Fields are found by label and the submit by role, not by Payload's `#field-email` ids — those
are internal markup, and a login form whose inputs have no reachable accessible name is a
defect worth failing on. Both admin planes enter the axe gate in Phase 4 (`07` §2); this
asserts reachability only.

`fillLoginForm` fills and then asserts the value stuck, retrying via `toPass`. Payload's login
form is a client component with controlled inputs, so a fill landing between first paint and
hydration is discarded when React mounts, and the form submits blank reporting both fields
required. It reproduced with three workers against a cold server and never in a single run.

## 15. The paste normalizer, wired to the editor

`src/lib/paste-normalizer.ts` has been complete and unwired since PR #6. This is the wiring
and the prompt. The transform is unchanged — no normalization logic lives in this slice.

### Added

| File                                                  | What it does                                           |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `src/admin/PasteNormalizer/feature.client.tsx`        | `createClientFeature`, registers the plugin            |
| `src/admin/PasteNormalizer/PasteNormalizerPlugin.tsx` | `PASTE_COMMAND` handler, insertion, prompt state       |
| `src/admin/PastePrompt/PastePrompt.tsx`               | the dialog — removals and the heading question         |
| `src/admin/PastePrompt/PastePrompt.module.css`        | DD2 tokens, logical properties                         |
| `src/admin/PastePrompt/PastePrompt.stories.tsx`       | four states; puts the dialog in the component axe gate |
| `tests/e2e/paste-normalizer.spec.ts`                  | the flow through the real editor, plus an axe pass     |
| `tests/e2e/admin-session.setup.ts`                    | signs in once per run                                  |

`src/admin/` is new: admin-plane React, as distinct from `src/components/`, which is the
public design system and may not import the Payload SDK. Phase 4's task plane and diff viewer
belong here too.

### Changed

| File                                   | Change                                                             |
| -------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/editor.ts`                    | `PasteNormalizerFeature` + `DD2_FEATURE_KEYS`                      |
| `tests/unit/editor.test.ts`            | the allowlist now expects `pasteNormalizer`                        |
| `playwright.config.ts`                 | an `admin-setup` project both browser projects depend on           |
| `tests/a11y/storybook.spec.ts`         | the fail-closed guard injects into an open modal when there is one |
| `src/app/(payload)/admin/importMap.js` | regenerated                                                        |

### The flow

1. `PASTE_COMMAND` fires. No `text/html` on the clipboard → return `false`, and Lexical's own
   plain-text path runs.
2. `normalizePastedHtml` runs on the HTML flavour.
3. No rejections and no heading candidates → insert, no dialog. The common case costs nothing.
4. Otherwise the result is held in state and the prompt opens.
5. On resolve, `promoteHeadings` is applied if the answer was yes, and the result is inserted.

**Nothing is inserted before the prompt resolves.** Promoting after insertion would mean
tracking which nodes came from this paste and rewriting them through a selection the author may
have moved; asking first uses `promoteHeadings` exactly as it is unit-tested, and the author
never sees content change under them.

**Every exit inserts** — yes, no, Escape, backdrop. A dismissal that discarded the paste would
lose a whole agenda to a keypress that means "stop asking me".

### The prompt

One modal per paste, carrying both messages: what was removed, then the heading question. The
wording of the question is fixed by `07` §4.2 and is not paraphrased. The answer is one yes for
all candidate lines — the lines are listed so the answer is informed, but a per-line checklist
would require the author to know what a heading is in order to answer.

A native `<dialog>` with `showModal()`. Focus moving in, focus trapped, Escape, focus restored
to the editor, background inert — all from the element. Payload's own modal was the alternative
and would have meant adopting `@payloadcms/ui` as a directly pinned dependency for behaviour
the platform already has.

Styled from DD2 tokens rather than Payload's `--theme-elevation-*`, so what the component axe
gate measures is what the admin paints. Payload's own admin chrome enters the gate in Phase 4
(`07` §2), which is why the e2e axe pass is scoped to the dialog.

### Lexical imports

Everything comes through Payload's proxy — `@payloadcms/richtext-lexical/lexical`,
`/lexical/html`, `/lexical/react/LexicalComposerContext`. Importing `lexical` directly would
mean a second copy of the library and therefore a second node registry, where nodes created
against one are unrecognisable to the other. It also adds no dependency to `package.json`.

### `DD2_FEATURE_KEYS`

`TRIAGED_FEATURES` answers "what did Payload ship that nobody has decided about", and its
assertion compares against the package's own exports — so a feature we wrote cannot go in it
without breaking the upgrade guard. `DD2_FEATURE_KEYS` is the separate list, and the test
asserts no key in it collides with a Payload one.

### One login per run

`admin-session.setup.ts` runs as a setup project both browser projects depend on, so it
completes before any worker starts. Payload 3 puts a session id in the token and tracks live
sessions on the user document: several concurrent logins as the same user race on that list, the
last write wins, and the other tokens reference sessions that no longer exist. Seven parallel
specs each authenticated successfully and then found themselves logged out. Per-worker
authentication has the same defect; the barrier is the fix.

Side effect worth having: the e2e suite went from 33s to 6s.

### Tenant assignment is part of the flow

A district-admin works across all 28 sites (`04` §3.2), so the multi-tenant plugin asks which
tenant a new page belongs to before the form is usable. The spec answers the modal rather than
seeding a default tenant to skip it — it is a step every district author takes. It is waited
for, not probed for: the modal renders after hydration, so an "if present" check passes on a
fast machine and then the modal opens over the form mid-test.

---

## 16. The tenant front page, and the public page template

### Added

| File                                       | What it does                                                          |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `src/components/RichText/`                 | Renders a DD2 rich-text body. `RichText.tsx` + `index.ts` + 2 stories |
| `tests/unit/components/rich-text.test.tsx` | 11 tests over blocks, marks, links, nested lists, heading levels      |

### Changed

| File                                      | Change                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/lib/slug.ts`                         | `ROOT_SLUG`; `buildPagePath` collapses a lone `['home']` to `/`                    |
| `src/content/pages.ts`                    | `/` resolves the front page; `/home` refused; `listPagePaths` skips pages under it |
| `src/collections/hooks/page-slug.ts`      | `rootPageCannotBeParent`, registered on `Pages.hooks.beforeValidate`               |
| `src/app/(frontend)/.../page.tsx`         | Renders the resolved page; the Phase 2 diagnostic `<dl>` is gone                   |
| `scripts/seed.ts`                         | Seeds `home`, `about`, and `staff` (nested) per tenant                             |
| `tests/e2e/tenant-routing.spec.ts`        | Asserts rendered pages instead of `data-testid` diagnostics                        |
| `tests/integration/content-layer.test.ts` | 21 tests over `getPageByPath` / `listPagePaths`, which had none                    |

### How `/` resolves

A tenant's front page is an ordinary top-level page slugged `home` (`ROOT_SLUG`). `/` has no
segment to walk, so `getPageByPath` looks up that slug with no parent.

**`/home` is refused, not redirected.** One page, one URL, one CDN cache entry, one canonical.
Refusing keeps `getPageByPath` a pure lookup; a redirect is a routing concern if DD2 ever wants
one.

**Only a lone `home` is the front page.** `buildPagePath` collapses `['home']` to `/` and
nothing else — stripping a leading `home` from `['home','about']` would produce `/about` and
collide with a real top-level `about`, giving two pages one path.

`home` is deliberately **not** in `RESERVED_SLUGS`. That list is for slugs colliding with a
platform _route_; reserving this one would make the front page uncreatable. `rootPageCannotBeParent`
refuses the nested shape on write, and `listPagePaths` skips it on read — validation and
resolution are separate guarantees, and a migration only has to defeat the first.

### What the route does

`resolve()` is shared by `generateMetadata` and the component so the two cannot describe
different pages — metadata for one page above another's body is exactly the mismatch that then
gets cached. The duplicate query is affordable: neither caller runs per visitor.

Four conditions produce a 404, and they are deliberately indistinguishable: unknown host,
missing page, draft, staff-only. A "not published yet" message would leak the existence and
title of unpublished content to anyone guessing URLs (`03` §6.4).

The template owns the `h1` (`PAGE_TITLE_LEVEL`) and `RichText` clamps the author's headings to
`h2` and below, so an editor cannot produce a heading-order violation by writing one.

`data-cache-tag` now carries both the tenant tag and the page's document tag: publishing one
page purges its own artifact, and a tenant-wide change purges every page (`09` §4.2).

The front page's `<title>` is the **tenant's** name, not the page's. Every tenant's front page
row is called "Home"; putting that in the tab and the search result would describe 28 sites
identically.

### Seeded fixtures

`pnpm run seed` gives every tenant `home`, `about`, and `staff` nested under `about` — enough
for the e2e suite to exercise segment walking, and deliberately **not** `/athletics`, which is
the path the suite asserts 404s.

The seed writes as a district-admin. `overrideAccess` bypasses access functions but not
`beforeChange` hooks, so `publishGate` throws `Forbidden` on a published write with no user —
the gate working, not something to route around by relaxing it.

### Why the e2e spec was reworked

`tenant-routing.spec.ts` read `data-testid` diagnostics (`tenant-slug`, `locale`, `path`) at
paths with no pages behind them. Those existed because the Phase 2 route rendered no content
and there was nothing else to look at. Once the route 404s unknown paths — the correct
behaviour — those assertions could not survive.

It now asserts the rendered page: `<title>` distinguishes tenants, the `h1` and body prove the
Lexical -> `toRichText` -> `RichText` chain end to end, `/about/staff` proves parent-chain
walking, and `/athletics` and `/home` prove the two 404s. A testid can stay green while the
page a visitor sees is wrong; a title and a heading cannot.

### Metadata is asserted on the response, not the DOM

**Next streams metadata after the body** when `generateMetadata` resolves later than the shell,
and React hoists it into `<head>` during hydration. A fresh server therefore emits `<title>` and
the `hreflang` links inside `<head>`; a warm one emits them after `</body>` and lets the client
file them. `page.locator('head link[rel="alternate"]')` is a locator whose truth depends on
which of those happened — it passed run alone and failed deterministically once other specs had
warmed the server.

`documentFor()` fetches the page and parses the HTML instead. That is also the more honest
assertion: `hreflang` and the document title are signals for crawlers and link previews, which
parse the bytes and never hydrate. What matters is that the markup is IN the response, not where
a browser eventually files it. The alternates are compared as a whole map, so a missing locale
and a stray extra one both fail.

## 17. The block library — infrastructure and the first two blocks

`03` §3 holds the register (what exists, in which dependency batch, and what is deliberately
absent). This section is the mechanical map: what calls what.

### Added

| File                                    | What it does                                                    |
| --------------------------------------- | --------------------------------------------------------------- |
| `src/collections/blocks/index.ts`       | Payload block schemas; exports `blockLibrary`                   |
| `src/content/blocks.ts`                 | `toPageBlocks` — Payload rows to DD2 blocks                     |
| `src/blocks/BlockList.tsx`              | The renderer registry; owns heading level and inter-block space |
| `src/blocks/RichTextBlock/`             | Prose block — a wrapper over `RichText`                         |
| `src/blocks/CallToAction/`              | Heading, supporting line, one button-styled link                |
| `src/blocks/index.ts`                   | Public surface of the library                                   |
| `tests/unit/blocks.test.ts`             | The mapper, plus the schema-to-mapper coupling check            |
| `tests/unit/components/blocks.test.tsx` | Heading levels, order independence, link semantics              |
| `src/blocks/*/**.stories.tsx`           | Storybook entries — enter the axe gate automatically            |

### Changed

| File                              | Change                                                         |
| --------------------------------- | -------------------------------------------------------------- |
| `src/collections/Pages.ts`        | `layout` blocks field, district-only, shown only on `composed` |
| `src/content/types.ts`            | `PageBlock` union; `Page.layout`                               |
| `src/content/pages.ts`            | `toDomain` maps `layout` through `toPageBlocks`                |
| `src/content/index.ts`            | Exports the block types                                        |
| `src/components/Link/Link.tsx`    | `variant: 'inline' \| 'button'`                                |
| `src/app/(frontend)/.../page.tsx` | Renders `<BlockList>` after `<RichText>`                       |
| `src/payload-types.ts`            | Regenerated                                                    |

### The call chain

```
Payload `pages.layout` rows
  -> src/content/pages.ts        toDomain()
  -> src/content/blocks.ts       toPageBlocks()   <- the only place `blockType` is read
  -> PageBlock[]                 (DD2 domain types)
  -> src/app/(frontend)/.../page.tsx
  -> src/blocks/BlockList.tsx    exhaustive switch on `block.kind`
  -> src/blocks/*/               one renderer per block
```

The two halves of a block sit in different directories because `src/blocks/` may not import
the Payload SDK (rule 1) while the schema must. They are joined by one string: the Payload
`slug` is the `blockType` the mapper switches on. `tests/unit/blocks.test.ts` pins that join —
renaming a slug without updating the mapper fails there, because it iterates the real
`blockLibrary` rather than a restated list.

### Where each guarantee is enforced

| Guarantee                                      | Enforced in                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Blocks are district-only                       | `pagesUpdateAccess`, `districtOnlyField` on `layout`, `composedPagesAreDistrictOnly` |
| No block can break heading order               | No level field in the schema; `BlockList` derives and floors it                      |
| A block never becomes the page's second `h1`   | `BlockList` floors `baseLevel` at `BLOCK_HEADING_LEVEL`                              |
| An unknown block never breaks a build          | `toPageBlocks` drops unrecognised `blockType`s                                       |
| A new block type cannot be silently unrendered | `BlockList`'s `never` check — a compile error, not a blank space                     |
| No physical properties                         | stylelint; the RTL half of the story axe gate                                        |

### `BlockList` floors the heading level, and why that is not `Heading`'s job

`Heading` clamps to the 1–6 range but does not refuse `h1` — it cannot, because the page title
legitimately needs one. So `baseLevel={1}` would give every block a second `h1`. `BlockList`
floors it once, centrally; `RichText` does the same on the fixed-page path. A block that had to
remember this could forget, and the claim in `03` §3.2 is that no block author has to remember
anything about levels.

### `Link` gained a variant rather than a `className`

A call to action's button is an `<a>` — it navigates. It needed button styling, and `Link`
takes no `className` on purpose: a class prop would let any caller silently remove the
underline `Link` exists to guarantee. `variant: 'inline' | 'button'` keeps every presentation
a decision made inside the component, with the reasoning for dropping the underline next to
the rule that normally requires it. The `button` variant replaces the cue rather than dropping
it — fill, radius and padding mean the affordance does not read as body text.

### No migration

`migrationDir` is configured only under `NODE_ENV=production`, and no migrations are committed
yet, so `layout` needs none today. It is additive when they start — expand, never contract.

## 18. Three more Batch 1 blocks — Accordion, CardGrid, Divider

`03` §3.1 is the register. This is the mechanical addition to §17's infrastructure — a block
is now four things, and none of them is new machinery.

### Added

| File                    | What it does                    |
| ----------------------- | ------------------------------- |
| `src/blocks/Accordion/` | Native `<details>` disclosures  |
| `src/blocks/CardGrid/`  | A list of short, parallel items |
| `src/blocks/Divider/`   | An `<hr>` thematic break        |

### Changed

| File                              | Change                                                 |
| --------------------------------- | ------------------------------------------------------ |
| `src/collections/blocks/index.ts` | Three schemas; `blockLibrary` in editor-facing order   |
| `src/content/blocks.ts`           | Three mapper cases                                     |
| `src/content/types.ts`            | `AccordionBlock`, `CardGridBlock`, `DividerBlock`      |
| `src/blocks/BlockList.tsx`        | Three `case`s                                          |
| `src/payload-types.ts`            | Regenerated                                            |
| `starterDocs/03-...md`            | `Container` withdrawn from Batch 1; two new open items |

### The heading rule these three share

A block with its own heading puts its children one level below it; a block **without** one
makes its children the top level rather than skipping to leave a gap for a heading that does
not exist:

```
itemLevel = block.heading === null ? baseLevel : nextHeadingLevel(baseLevel)
```

Skipping would be the outline gap `07` §3 rules out, and it is the easy mistake in this shape
— hence a test for it on both `Accordion` and `CardGrid`.

### Why native `<details>` rather than a scripted disclosure

The browser supplies expand/collapse, keyboard handling, and the expanded/collapsed
announcement. The block works before hydration and cannot drift out of conformance when the JS
changes. The question is a heading **inside** the `<summary>` — valid per the HTML content
model — which keeps every question in the page outline, so a screen-reader user can find one
without tabbing through all of them.

### Why the card link is on the title

A card-sized click target is nicer with a mouse and worse with everything else: it either
swallows the blurb into the link's accessible name or needs a script and an overlay that breaks
text selection. A card is a heading that happens to link. The set is a `<ul>`, so a screen
reader announces "list, N items" and offers to skip it.

### The grid takes no column count

`repeat(auto-fit, minmax(min(100%, 16rem), 1fr))` — no media query, no editor-chosen column
count. It reflows on available space, so 1.4.10 holds at 320px and at 400% zoom, and the
page-builder offers one fewer layout decision.

### `Container` was withdrawn from Batch 1

A section wrapper's purpose is to contain other blocks, and blocks do not nest. Without nesting
it is a styling field wearing a block's clothes, which `03` §3.2 also rules out. It moved to
`03` §3.3 alongside the column layouts.

### Local gotcha

`pnpm test:e2e` boots a **production** server, which does not push schema. After a block is
added, run `pnpm run seed` (or a dev server) first, or the suite dies with `42P01` on the new
tables. That is CI's ordering too — build, seed, e2e.

---

## 19. `ChildPageNav` — the section menu, and how a block gets page context

The sixth Batch 1 block, and the first that renders something it was not stored with. It holds
one optional heading; the list of pages is the current page's children.

### Added

| File                       | Holds                                     |
| -------------------------- | ----------------------------------------- |
| `src/blocks/ChildPageNav/` | A `<nav>` of links to the page's children |

### Changed

| File                              | Change                                                                     |
| --------------------------------- | -------------------------------------------------------------------------- |
| `src/content/types.ts`            | `PageLink`; `Page.children`; `ChildPageNavBlock`                           |
| `src/content/pages.ts`            | `childrenOf` query in `getPageByPath`; children grouped in `listPagePaths` |
| `src/content/blocks.ts`           | `toChildPageNav`                                                           |
| `src/collections/blocks/index.ts` | `childPageNavBlock`                                                        |
| `src/blocks/BlockList.tsx`        | Required `childPages` prop; the `case`; the empty-menu filter              |
| `.../[[...segments]]/page.tsx`    | Passes `page.children`                                                     |
| `src/payload-types.ts`            | Regenerated                                                                |
| `starterDocs/03-...md`            | §3.2 gains the page-context rule; §3.3's data-shape item resolved          |

### The data path

```
getPageByPath      -> resolves the page, then ONE query for its published, public children
listPagePaths      -> groups children in memory from the tenant-wide query it already runs
  toDomain(doc, path, children)  ->  Page.children: PageLink[]
    route          ->  <BlockList blocks={page.layout} childPages={page.children} />
      BlockList    ->  <ChildPageNav pages={childPages} />
```

`src/blocks/` may not import the Payload SDK (rule 1), so the block cannot fetch. The children
ride on the **page** — beside `path` and `parentId` — rather than on the block, because a
page's position in its own tree is a fact about the page. `toPageBlocks` therefore stays a pure
function over JSON, which is what lets the Phase 9 migration mappers run it with no CMS
(`10` §5).

`listPagePaths` maps every published page in the tenant (`limit: 5000`), so a per-page child
query there would be an N+1 across 28 tenant builds. It already holds every row and every
resolved path, so grouping is free. A test asserts the two paths return the same children for
the same page — the build and the resolver must not disagree.

### Only children with a reachable URL

The same `publishedAndPublic` filter the page itself passed, plus one case that is easy to
miss: **the front page has no children.** A page under `home` would have the path
`/home/<slug>`, which `getPageByPath` refuses so the front page has exactly one URL — so it has
no URL at all, and `listPagePaths` already skips it. `rootPageCannotBeParent` refuses the shape
on write; this is the resolution half of the same guarantee, and only one of the two survives a
migration or a direct database write.

A draft or staff-only child would leak its title and URL into a public menu and 404 when
clicked (`03` §6.4).

### Two places decide emptiness, and they answer different questions

`ChildPageNav` is the only block whose emptiness the mapper cannot judge — its content is not
in its own row. So:

- **`ChildPageNav`** returns null when handed no pages. That is the component's contract; it is
  exported and can be rendered directly.
- **`BlockList`** filters it out _before_ mapping, because a null inside `Stack` is still a flex
  item and would take a gap on both sides — a hole in the page. Spacing belongs to the thing
  that owns spacing.

### `childPages` is required, not defaulted

A default of `[]` would let a template that forgot the prop render a section menu as nothing —
in the admin, in the database, blank on the published page. That is exactly the silent failure
`BlockList`'s exhaustive `switch` exists to prevent, so it is a compile error instead. Layouts
with no menu pass `[]`; passing it is the point.

### Ordering, and what is deliberately absent

Alphabetical by title, sorted **in memory** with an explicit `'en'` locale so the querying path
and the grouping path cannot order the same children differently. `pages` has no ordering
field, and adding one is an authoring-model decision — recorded as open in `03` §3.3.

No depth field either: one level. Both are decisions the platform makes so a school manager
does not have to.

### Accessibility

A `<nav>` landmark, named — by its own heading via `aria-labelledby` when it has one, so the
announced name and the visible words cannot drift; otherwise `aria-label="In this section"`.
The page template already renders a language `<nav>`, and two unnamed landmarks of the same
role are worse than one.

The child titles are **links, never headings**. Nine of them would otherwise put nine entries
in the page outline and bury the page's real structure.

### The cross-document dependency

This is the first block whose output depends on a document other than the one being rendered:
publishing a child changes the parent's page. The parent emits only `documentTag('pages', <own
id>)`, so purging on a child publish is not covered. The revalidation hooks are not wired yet
(the route emits `data-cache-tag` and nothing consumes it) — this is a note for whoever wires
them (`09` §4.2).

### Not a general mechanism

`FeedBlock`, `StaffList`, `DocumentList` and `Gallery` render an editor-**configured** query,
which is a different problem. `03` §3.2 records why they do not inherit this shape and what is
likely to fit them instead, decided in Phase 5.

---

## 20. `Embed` — the allowlisted video block

The seventh and last Batch 1 block. It stores a pasted link and a required title; what it
renders is built from constants.

### Added

| File                           | Holds                                                   |
| ------------------------------ | ------------------------------------------------------- |
| `src/lib/embed-url.ts`         | `toEmbedTarget` — the normalizer and the allowlist      |
| `tests/unit/embed-url.test.ts` | 19 tests: the shapes editors paste, and what is refused |
| `src/blocks/Embed/`            | Frame plus the visible fallback link                    |

### Changed

| File                              | Change                                                 |
| --------------------------------- | ------------------------------------------------------ |
| `src/collections/blocks/index.ts` | `embedBlock`, with a `validate` calling the normalizer |
| `src/content/blocks.ts`           | `toEmbed`                                              |
| `src/content/types.ts`            | `EmbedBlock`                                           |
| `src/blocks/BlockList.tsx`        | The `case`                                             |
| `src/payload-types.ts`            | Regenerated                                            |
| `starterDocs/03-...md`            | Register row; two new open items in §3.3               |

### The allowlist applies to what we render, not to what was typed

`02` §7 and `07` §6 both say "domain allowlist, no free-form iframe source". The naive reading
is a host check on the pasted string, and it is not enough — a string that passes a host check
is still a person's string going into a frame source.

`toEmbedTarget` extracts the video id and **rebuilds** both URLs from constants:

```
<anything an editor pasted>  ->  { src:  https://www.youtube-nocookie.com/embed/<id>[?start=<n>]
                                   href: https://www.youtube.com/watch?v=<id> }
```

Everything else is dropped: playlists, `si=` share tracking, `feature=`.

### It normalizes rather than validates, because of who is pasting

A school manager pastes whatever the share dialog gave them. All of these work:

```
https://www.youtube.com/watch?v=<id>        https://youtu.be/<id>?t=90
https://www.youtube.com/live/<id>           https://www.youtube.com/shorts/<id>
https://m.youtube.com/watch?v=<id>          www.youtube.com/watch?v=<id>   (no scheme)
<iframe width="560" ... src="..."></iframe> ("copy embed code" — the other button on the dialog)
```

A validator refuses the last three and reads as broken software (`04` §2.1). The start time
survives too, in all of `90`, `90s`, `1m30s`, `1h2m3s`, because "start at" is a checkbox on the
same dialog.

### What it refuses, and the two that are not obvious

Non-YouTube hosts, non-http schemes, protocol-relative `//host/path`, and any id that is not
eleven characters of `[A-Za-z0-9_-]` — a different length means the parse went wrong, and a
misparse must fail rather than build a frame source out of whatever it found.

Two cases worth naming because a reasonable implementation gets them wrong:

- **The suffix attack.** `youtube.com.evil.test` passes `endsWith('youtube.com')` and
  `includes('youtube.com')`. Hosts are matched exactly or as a subdomain, never as a substring.
- **Markup laundering.** The `<iframe>` `src` is only extracted when the input _starts with_
  `<`. Searching any string for an iframe means
  `data:text/html,<iframe src="https://youtube.com/...">` yields a legitimate URL and the
  scheme check never sees the `data:`. The test suite caught this one; it was a real bug in the
  first draft.

### The no-cookie host is deliberate

Every embed renders through `www.youtube-nocookie.com`, which sets no tracking cookie unless
the visitor plays the video. `03` §3.3 records third-party tracking on pages visited by minors
as a district policy question rather than a feature decision — defaulting to the privacy host
keeps this block out of that conversation.

### Two layers, and why the second is the one that holds

The field `validate` calls the normalizer so an editor is told at once. The **mapper** calls it
again, and that is the real gate: it also covers rows written by a migration or a direct
database write, which never reach a validator. One normalizer, so there is one definition of
what is allowed.

### The fallback link is not optional

`07` §6: an embed is DD2's accessibility obligation even though DD2 did not build it. The frame
can be blocked at the network, refused by a browser setting, or unusable with the visitor's
assistive technology, and the visible link is what keeps the content reachable in every one of
those cases. It points at the **watch page**, never the frame URL — an embed URL opened as a
page is a bare player with no title, description or captions menu.

Captions stay policy, not schema (`07` §6, 2026-08-28): they are configured on YouTube, so a
field here would record a claim rather than enforce a state.

### The stories use `about:blank` on purpose

Storybook stories are the fixtures for the component axe gate, which runs in real Chromium on
every PR. A live YouTube URL there would make this repo's accessibility gate depend on a third
party being reachable from a CI runner. Nothing is lost: everything the component owns is
outside the frame — the `title`, the ratio, the fallback link — and what is inside is the
vendor's conformance, which axe cannot see across origins and which `07` §6 tracks through a
VPAT. The real URL shape is pinned in `tests/unit/embed-url.test.ts`.

### Open: the allowlist is one layer, not two

`02` §7 calls for CSP at the edge, and there is **no CSP configured anywhere in the repo** — no
`frame-src`, no security headers. So "domain-allowlisted" is currently an application-layer
claim only. That belongs to Phase 8 hardening; it is recorded here so it is not mistaken for
done.

---

## 21. Navigation — the per-tenant menus, and the header and footer

`03` §5 calls `navigation` a per-tenant global. It is built as a tenant-scoped collection with
one row per tenant; the header and footer that render it are the first site chrome.

### Added

| File                                         | Holds                                                            |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `src/lib/href.ts`                            | `toSafeHref`, `isSitePath` — the destination allowlist           |
| `src/collections/Navigation.ts`              | Three arrays (`primary`, `utility`, `footer`) of label/href/tab  |
| `src/content/menus.ts`                       | `toNavigation` — the pure mapper, `unknown` in, `Navigation` out |
| `src/content/navigation.ts`                  | `getNavigation(ctx)` — the query                                 |
| `src/components/MenuList/`                   | One named `<nav>` + list; shared by header and footer            |
| `src/components/SiteHeader/`                 | Banner: site name, quick links, main menu                        |
| `src/components/SiteFooter/`                 | Contentinfo: footer menu, site name                              |
| `tests/unit/href.test.ts`                    | 36 tests: the four accepted shapes and what is refused           |
| `tests/unit/menus.test.ts`                   | 15 tests: mapping, dropping, no Payload fields leaking           |
| `tests/unit/components/site-chrome.test.tsx` | Landmarks, names, `aria-current`, locale prefixes                |

### Changed

| File                                         | Change                                                          |
| -------------------------------------------- | --------------------------------------------------------------- |
| `src/payload.config.ts`                      | Collection registered; `navigation: { isGlobal: true }`         |
| `src/content/types.ts`                       | `MenuLink`, `Navigation`                                        |
| `src/components/Link/Link.tsx`               | `current` prop -> `aria-current="page"`                         |
| `.../[[...segments]]/page.tsx`               | Fetches menus; renders `SiteHeader` and `SiteFooter`            |
| `src/app/(payload)/admin/importMap.js`       | Regenerated — `isGlobal` adds the plugin's `GlobalViewRedirect` |
| `scripts/seed.ts`                            | Menus per tenant, created only when absent                      |
| `tests/helpers/payload.ts`                   | `navigationA` / `navigationB` fixtures                          |
| `tests/integration/tenant-isolation.test.ts` | 8 cases: district-only, one row per tenant, unsafe hrefs        |
| `tests/integration/content-layer.test.ts`    | `getNavigation`: own tenant only, empty when absent             |
| `tests/e2e/tenant-routing.spec.ts`           | Landmarks, current page, locale prefixes, a followed link       |
| `src/payload-types.ts`                       | Regenerated                                                     |
| `starterDocs/03-...md`                       | §5: how a per-tenant global is expressed                        |

### The call chain

```
page.tsx
  resolve()                      tenant + page, or 404 — no menu query on a 404
  getNavigation(ctx)             src/content/navigation.ts
    payload.find('navigation',   where tenant = ctx.tenant.id, limit 1, overrideAccess
    toNavigation(docs[0])        src/content/menus.ts — undefined row -> three empty menus
      toSafeHref(row.href)       src/lib/href.ts — item dropped when null
  <SiteHeader primary utility currentPath=page.path locale>
    <MenuList>                   null when links is empty
      <Link current href=...>    localizedPath(href, locale) only when isSitePath(href)
  <main>…</main>
  <SiteFooter links=footer …>
```

### One row per tenant

`navigation: { isGlobal: true }` in the multi-tenant plugin config does two things: the injected
`tenant` field is created `unique`, and the admin opens the tenant's row directly rather than a
list. A second `create` for the same tenant fails at the database — pinned by the isolation
suite. `theme` and `settings` (`03` §5) register the same way.

### Access

All four operations are `districtOnly`. A school-manager is refused their own tenant's row as
well as another's, so the isolation cases run against both. There is no anonymous grant:
`getNavigation` runs with `overrideAccess: true`, and its `tenant` clause is the only scoping on
that path — `content-layer.test.ts` asserts School B's labels never appear in School A's menus.

No drafts or versions: a saved menu is live.

### Destinations

`toSafeHref` accepts four shapes — `/path` (not `//`), `http(s)://host…`, `mailto:a@b`,
`tel:+digits` — after trimming, and refuses any value containing whitespace, a backslash or a
control character. It runs twice: as the `href` field's `validate`, and again in `toNavigation`.
The `CallToAction` and `CardGrid` `href` fields do not use it yet.

### Header and footer are in the page, not the layout

`layout.tsx` receives `hostname` and `locale` but not `segments`, so it cannot supply
`currentPath`. `page.tsx` renders `SiteHeader` and `SiteFooter` as siblings of `<main>` inside a
fragment; they land directly under `<body>`, which is what gives `<header>` and `<footer>` their
banner and contentinfo roles. `SkipLink` stays in the layout and is still the first tab stop —
`smoke.spec.ts`'s bypass-blocks test now has a real header to skip.

`aria-current="page"` is set when `link.href === page.path` exactly. Both are unprefixed paths,
so the comparison is locale-independent. A parent is not marked on a child page.

### Landmark names

| Landmark     | Name          | Source                       |
| ------------ | ------------- | ---------------------------- |
| `navigation` | `Main`        | `SiteHeader` `primaryLabel`  |
| `navigation` | `Quick links` | `SiteHeader` `utilityLabel`  |
| `navigation` | `Footer`      | `SiteFooter` `label`         |
| `navigation` | `Language`    | `page.tsx`                   |
| `navigation` | block heading | `ChildPageNav`, when present |

An empty menu renders no `<nav>`. A tenant with no row renders a header holding only its name.

### Menus are flat

`MenuLink` has no `children`, and the arrays cap at 8 / 6 / 12 rows. The list is a wrapping flex
row with no client script; at 320px it becomes more rows. A section's own pages are reached
through `ChildPageNav` (§19).

### Cache

No new tag. The tenant tag already on `<main>` covers the menus. Nothing purges it yet — there is
still no `afterChange` revalidation hook on any collection; when it lands, `navigation` needs
`tenantTag(tenantId)` and nothing narrower.

### No migration

As §17: no migrations are committed yet, so the `navigation` tables need none today. When they
start, this is a new table — pure expand.

### Local gotchas

- A new collection needs `pnpm run seed` (or a dev server) before `pnpm test:e2e`, so `dd2_dev`
  gets the table — the production server Playwright boots does not push schema.
- After adding `isGlobal`, run `pnpm exec payload generate:importmap`. Without it the admin logs
  `PayloadComponent not found in importMap` for `GlobalViewRedirect` and the redirect silently
  does nothing; no test fails.
