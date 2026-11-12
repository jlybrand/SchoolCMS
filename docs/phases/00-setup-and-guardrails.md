# Phase 0 — Setup and guardrails

How the scaffold works: the build configuration, the two lint guardrails and their own test
suites, the CI gate order, the Payload mount point, and the empty shells that Phases 1–2
fill in.

Commit: `9d87334`.

---

## 1. File inventory

### Toolchain configuration

| File                 | Job                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.nvmrc`             | Pins Node `24.19.0`.                                                                                                                                                                                                                       |
| `.npmrc`             | Sets `engine-strict`, so a mismatched Node or pnpm fails at install rather than at runtime.                                                                                                                                                |
| `package.json`       | Declares `engines` (`node >=24.19.0 <25`, `pnpm >=11`), `packageManager: pnpm@11.20.0`, and every script listed in §4.                                                                                                                     |
| `tsconfig.json`      | `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`. Defines the two path aliases every other file uses: `@/*` → `./src/*` and `@payload-config` → `src/payload.config.ts`. |
| `next.config.mjs`    | Wraps the Next config in `withPayload(...)` and attaches four response headers to `/:path*`: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Strict-Transport-Security`.                                                  |
| `docker-compose.yml` | `postgres:18` as service `postgres`, published on host port **5433** → container 5432, database/user `dd2`, named volume `dd2-pgdata`, `pg_isready` healthcheck.                                                                           |
| `.env.example`       | The environment contract. `DATABASE_URI` and `PAYLOAD_SECRET` are read by `src/payload.config.ts` at module evaluation.                                                                                                                    |
| `lighthouserc.json`  | Budget consumed by `pnpm test:perf` (`lhci autorun`).                                                                                                                                                                                      |

`exactOptionalPropertyTypes` has one visible consequence downstream: config objects spread
optional keys conditionally (`...(process.env.CI ? { workers: 1 } : {})`) instead of
assigning `undefined`. This pattern appears in `playwright.config.ts` and again in
`src/payload.config.ts`.

### The two guardrails

| File                | Job                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `eslint.config.mjs` | **Guardrail 1** — content-boundary `no-restricted-imports`, plus the raised `jsx-a11y` rule set. |
| `.stylelintrc.json` | **Guardrail 2** — bans physical CSS properties and physical direction keywords.                  |

### Test configuration and suites

| File                                               | Job                                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `vitest.config.ts`                                 | Mirrors the tsconfig aliases into Vitest, includes `tests/unit/**` + `tests/integration/**`, `environment: node`. |
| `playwright.config.ts`                             | Two projects (`chromium`, `chromium-rtl`), `testDir: ./tests/e2e`, boots `pnpm run start` as its webServer.       |
| `tests/unit/guardrails/content-boundary.test.ts`   | Tests Guardrail 1's _rule_, by running ESLint programmatically.                                                   |
| `tests/unit/guardrails/logical-properties.test.ts` | Tests Guardrail 2's _rule_, by running Stylelint programmatically.                                                |
| `tests/e2e/smoke.spec.ts`                          | The axe gate and its fail-closed proof.                                                                           |
| `.github/workflows/ci.yml`                         | Five jobs in a fixed dependency order (§4).                                                                       |

### Application shells

| File                                        | Job                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/payload.config.ts`                     | `buildConfig({...})`. At Phase 0: `collections: [Users]`, Postgres adapter, `lexicalEditor()`, no plugins. |
| `src/collections/Users.ts`                  | Minimal Payload auth collection. Grown substantially in Phase 1.                                           |
| `src/content/types.ts`                      | Hand-written DD2 domain types.                                                                             |
| `src/content/index.ts`                      | The barrel the rendering layer imports from — re-exports types only at this phase.                         |
| `src/styles/tokens.css`                     | Design tokens as CSS custom properties on `:root`.                                                         |
| `src/styles/globals.css`                    | `@import './tokens.css'` plus base element styles.                                                         |
| `src/app/(payload)/**`                      | Payload's own mount point.                                                                                 |
| `src/app/(frontend)/layout.tsx`, `page.tsx` | Static placeholder page. **Both deleted in Phase 2** and replaced by the `sites/[hostname]/[locale]` tree. |

---

## 2. Guardrail 1 — the content boundary

### The rule

`eslint.config.mjs` declares two import pattern groups:

```js
const PAYLOAD_SDK = ['payload', 'payload/*', '@payloadcms/*', '@payloadcms/*/*']
const PAYLOAD_GENERATED_TYPES = ['**/payload-types', '**/payload-types.js', '@/payload-types']
```

Three config blocks decide where they apply:

| Block   | `files`                                                                      | `no-restricted-imports`                           |
| ------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| Guarded | `src/app/(frontend)/**`, `src/components/**`, `src/blocks/**` (`.ts`/`.tsx`) | `error` on both groups, each with its own message |
| Exempt  | `src/content/**/*.ts`                                                        | `off`                                             |
| Exempt  | `tests/**/*.ts`                                                              | `off`                                             |

`src/app/(payload)/**` and `src/collections/**` are never listed in the guarded block, so
the rule simply does not apply to them — they inherit the `eslint-config-next` defaults.

A fourth block raises eleven `jsx-a11y` rules to `error` across all of `src/**/*.{ts,tsx}`:
`alt-text`, `anchor-has-content`, `aria-props`, `aria-proptypes`,
`aria-unsupported-elements`, `heading-has-content`, `iframe-has-title`,
`img-redundant-alt`, `label-has-associated-control`, `no-redundant-roles`,
`role-has-required-aria-props`.

The top-level `ignores` block excludes `.next/`, `node_modules/`, `coverage/`,
`test-results/`, `playwright-report/`, `.lighthouseci/`, `src/payload-types.ts`,
`src/app/(payload)/admin/importMap.js`, and `next-env.d.ts`.

### The rule's own test

`tests/unit/guardrails/content-boundary.test.ts` constructs `new ESLint()` and calls
`eslint.lintText(code, { filePath })` with **virtual** file paths — the fixture files never
exist on disk. A local helper filters the returned messages:

```ts
const restricted = (msgs) => msgs.filter((m) => m.ruleId === 'no-restricted-imports')
```

Assertions, in two groups:

- **Enforced** — for each of four guarded paths (`src/app/(frontend)/page.tsx`,
  `src/app/(frontend)/[locale]/[...slug]/page.tsx`, `src/components/Header/Header.tsx`,
  `src/blocks/Hero/Hero.tsx`): a bare `payload` import is rejected, an `@payloadcms/*`
  import is rejected. Plus: `@/payload-types` is rejected, and `@/content` is allowed.
- **Exempt** — `src/app/(payload)/admin/[[...segments]]/page.tsx` importing
  `@payloadcms/next/views`, `src/content/pages.ts` importing `payload`, and
  `src/collections/Pages.ts` importing `CollectionConfig` all produce zero messages.

Note the last two reference files that do not exist yet (`src/content/pages.ts`,
`src/collections/Pages.ts`) — `lintText` resolves the config by path, not by file presence.

---

## 3. Guardrail 2 — logical properties

### The rule

`.stylelintrc.json` uses two stock Stylelint rules:

- `property-disallowed-list` — 40 physical properties: the four-sided `margin-*`/`padding-*`
  forms, every `border-<side>[-width|-color|-style]`, the four physical corner radii,
  `left`/`right`/`top`/`bottom`, `width`/`height` with their `min-`/`max-` variants, and
  `overflow-x`/`overflow-y`. Carries a custom message naming the logical equivalents.
- `declaration-property-value-disallowed-list` — `text-align: left|right`,
  `float: left|right`, `clear: left|right`, `resize: horizontal|vertical`.

`ignoreFiles` excludes `node_modules`, `.next`, `coverage`.

### The rule's own test

`tests/unit/guardrails/logical-properties.test.ts` calls
`stylelint.lint({ code, codeFilename: 'src/styles/probe.css' })` and reads
`result.results[0].warnings`. Three table-driven groups plus one live check:

| Group               | Count | Asserts                                                                  |
| ------------------- | ----- | ------------------------------------------------------------------------ |
| Banned properties   | 12    | each produces ≥1 warning                                                 |
| Banned keywords     | 4     | each produces ≥1 warning                                                 |
| Logical equivalents | 14    | each produces **zero** warnings                                          |
| Real stylesheets    | 1     | `stylelint.lint({ files: 'src/styles/*.css' })` yields `warnings === []` |

That last case is the only one reading real files; it is what keeps `tokens.css` and
`globals.css` themselves inside the rule.

---

## 4. Commands and the CI gate

### Scripts

`pnpm lint` is a composite — it runs all three sub-linters, and both guardrails ride on it:

```
lint → lint:js   (eslint .)                  ← Guardrail 1
     → lint:css  (stylelint "src/**/*.css")  ← Guardrail 2
     → lint:format (prettier --check .)
```

`pnpm test` runs Vitest over unit + integration. `pnpm test:unit` narrows to `tests/unit`,
which is where both guardrails' own suites live. `pnpm test:e2e:smoke` runs Playwright
filtered to `--grep @smoke`; `pnpm test:a11y` filters to `@a11y`.

### Job graph

`ci.yml` defines five jobs. Four form a chain via `needs:`; `security` runs independently.

```
static ──▶ test ──▶ e2e ──▶ lighthouse
(typecheck  (unit +  (build +   (lhci
 + lint)    integ.)   e2e/axe)   autorun)

security (pnpm audit --audit-level high) — no needs, runs in parallel
```

`static` does one thing before typechecking: it re-runs `generate:types` and
`generate:importmap`, then `git diff --exit-code` against `src/payload-types.ts` and
`src/app/(payload)/admin/importMap.js`. A drifted committed artifact fails the job here.

`test` and `e2e` each attach a `postgres:18` service container on port 5432 and export
`DATABASE_URI` / `PAYLOAD_SECRET` as job env. `e2e` additionally installs Chromium, runs
`pnpm build`, then `pnpm run seed` (added in Phase 2), then the smoke suite, and uploads
`playwright-report/` on failure.

### Playwright projects

| Project        | Device         | Extra                                 | `grep`   |
| -------------- | -------------- | ------------------------------------- | -------- |
| `chromium`     | Desktop Chrome | —                                     | all      |
| `chromium-rtl` | Desktop Chrome | `locale: 'ar'`, `Accept-Language: ar` | `/@rtl/` |

`baseURL` is `PLAYWRIGHT_BASE_URL` or `http://localhost:${PORT}` (`PORT` defaults 3000).
Under CI: `retries: 2`, `workers: 1`, `forbidOnly`, GitHub + HTML reporters.

---

## 5. The axe gate

`tests/e2e/smoke.spec.ts` defines the blocking set once:

```ts
const BLOCKING_IMPACTS = ['critical', 'serious']
```

Every axe test follows the same three-step shape: `page.goto(...)`, then

```ts
new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
```

then filter `results.violations` by `BLOCKING_IMPACTS` and assert. Six tests:

| Test                             | Tags                | Asserts                                                                                                                           |
| -------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| home page renders                | `@smoke`            | an `h1` is visible                                                                                                                |
| zero critical/serious violations | `@smoke @a11y`      | filtered violations `toEqual([])`, with a formatted failure message                                                               |
| **the axe gate fails closed**    | `@smoke @a11y`      | injects an `<img>` with no `alt` via `page.evaluate`, expects `image-alt` in the blocking ids                                     |
| `html` carries a valid `lang`    | `@smoke @a11y`      | the attribute is truthy                                                                                                           |
| `html` carries an explicit `dir` | `@smoke @rtl @a11y` | the attribute is `'ltr'` or `'rtl'` — declared, not inherited. The only test in the `chromium-rtl` project at Phase 0             |
| keyboard focus is visible        | `@smoke`            | presses `Tab`, reads `outlineStyle` off `document.activeElement`, asserts it is not `'none'` (skipped when focus stays on `body`) |

The fail-closed test is the axe-layer counterpart to the two guardrail suites in §2–3: all
three assert that the _gate_ still detects, not that the application passes.

---

## 6. Styles

`globals.css` starts with `@import './tokens.css'`, so importing `globals.css` alone pulls
the token layer. Phase 2's `SiteLayout` is the only importer.

`tokens.css` declares custom properties on `:root` in named groups: neutrals
(`--color-surface`, `--color-text`, …), brand (`--color-brand`, `--color-brand-contrast`),
alert severity (`--color-info`/`--color-warning`/`--color-emergency`), focus
(`--focus-ring-color`/`-width`/`-offset`), and a type scale
(`--font-family-base`, `--font-size-base` → `--font-size-2xl`). Measured contrast ratios are
recorded in comments beside the color pairs.

`globals.css` sets `box-sizing` on `*`, base `html`/`body` typography from the tokens, a
`main` reflow rule for 200–400% zoom, list and link defaults, a focus-visible indicator
built from the focus tokens, media element defaults, and a
`@media (prefers-reduced-motion: reduce)` block.

Both files are written entirely in logical properties, and the last case in the Guardrail 2
suite lints them on every unit run.

---

## 7. The content-layer shells

`src/content/types.ts` holds five exported types, all hand-written:

```ts
type Locale = string
type TenantType = 'district' | 'school'
type Tenant = { id: string; slug: string; name: string; hostname: string; type: TenantType }
type Visibility = 'public' | 'staff'
type ContentContext = { tenant: Tenant; locale: Locale }
```

`src/content/index.ts` re-exports all five and nothing else. Its header lists the function
signatures each later phase adds to this directory (`getPageBySlug`, `listPosts`,
`listEvents`, `listPeople`, `listDocuments`, `getActiveAlerts`).

`Tenant.id` is `string` even though Postgres issues serial integers. Every mapper in
`src/content/` is responsible for the `String(...)` conversion; Phase 2's
`src/content/tenants.ts` is the first to do it, and Phase 1's access predicates normalize
the same way for comparison.

---

## 8. Payload at Phase 0

`src/payload.config.ts` at this phase:

- `admin: { user: Users.slug, importMap: { baseDir: path.resolve(dirname) } }`
- `collections: [Users]`
- `db: postgresAdapter({ pool: { connectionString: process.env.DATABASE_URI ?? '' } })`
- `editor: lexicalEditor()` — unconstrained
- `plugins: []`
- `secret: process.env.PAYLOAD_SECRET ?? ''`
- `typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') }`
- `migrationDir` spread in **only** when `NODE_ENV === 'production'`

Both `process.env` reads happen at module-evaluation time. That timing is what forces
Phase 2's `tests/setup/env.ts` to be a Vitest `setupFiles` entry rather than helper code.

`src/app/(payload)/` holds four route files plus a layout, all importing `@payloadcms/next`:
`admin/[[...segments]]/page.tsx` and `not-found.tsx`, `api/[...slug]/route.ts`,
`api/graphql/route.ts`, and `layout.tsx`. `admin/importMap.js` is generated and committed;
`ci.yml` proves it current.

---

## 9. What later phases attach here

| Seam                                          | Filled by                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `payload.config.ts` → `collections`           | Phase 1 adds `Tenants`; content collections follow in Phase 3+            |
| `payload.config.ts` → `plugins`               | Phase 1 adds `multiTenantPlugin`                                          |
| `src/content/index.ts`                        | Phase 2 adds `getTenantByHostname` / `listActiveTenants` via `tenants.ts` |
| Guardrail 1's guarded globs                   | Phase 2's `src/app/(frontend)/sites/**` route tree lands inside them      |
| `src/app/(frontend)/layout.tsx`, `page.tsx`   | Deleted in Phase 2                                                        |
| `chromium-rtl` project                        | Phase 2 adds the first real `@rtl` route test                             |
| `vitest.config.ts` → `setupFiles`, `coverage` | Phase 2 adds `tests/setup/env.ts` and `fileParallelism: false`            |
