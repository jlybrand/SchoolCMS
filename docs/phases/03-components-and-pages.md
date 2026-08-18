# Phase 3 — Component library and pages

How the rendering foundation works: heading ownership, the layout primitives, the token
contrast checker, and the two accessibility gates that sit under all of it.

Phase 3 lands across several PRs. This document is written as each one merges.

| Slice                                      | State                                                     |
| ------------------------------------------ | --------------------------------------------------------- |
| Component foundation                       | **Landed** — §1–§7 below                                  |
| Paste normalizer                           | Landed early (PR #6); not yet wired to an editor — see §8 |
| `pages` collection (schema, access, gates) | **Landed** — §9–§12 below                                 |
| Page templates and rendering               | Not started                                               |
| Block library                              | Not started                                               |
| Constrained rich text (Lexical)            | Not started                                               |
| Navigation global, SEO, sitemap            | Not started                                               |

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

| Absent            | Arrives with                                                                     |
| ----------------- | -------------------------------------------------------------------------------- |
| Body content      | The constrained rich-text slice (`07` §4), which also wires the paste normalizer |
| `layout` (blocks) | The block library. `pageType: composed` is already selectable and already gated  |
| `seo` group       | `plugin-seo` — hand-rolling one now would mean deleting it later                 |
| Page templates    | The next slice: rendering a fixed-type page through the Phase 3 components       |

The domain `Page` type in `src/content/types.ts` is therefore the page **spine** — identity,
hierarchy, type, visibility. Declaring a body shape before either body mechanism exists
would be the speculative modelling `03` §4 warns against.
