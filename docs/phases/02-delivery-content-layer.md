# Phase 2 — Delivery, caching and the content-access layer

How a public request becomes a rendered page: the edge proxy rewrite, the locale helpers,
the route tree, the first real content-access functions, and the cache-tag vocabulary.

Commit: `2007ae0`.

---

## 1. File inventory

### Added

| File                                                                    | Job                                                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/proxy.ts`                                                          | Edge proxy. Rewrites every public request to `/sites/{host}/{locale}/…`          |
| `src/lib/locales.ts`                                                    | Locale constants, path prefix parsing/building, `dir`, `hreflang`                |
| `src/lib/cache-tags.ts`                                                 | Cache-tag construction and the per-document fan-out                              |
| `src/content/tenants.ts`                                                | `getTenantByHostname`, `listActiveTenants` — first functions behind the boundary |
| `src/app/(frontend)/sites/[hostname]/[locale]/layout.tsx`               | `<html lang dir>` root layout                                                    |
| `src/app/(frontend)/sites/[hostname]/[locale]/[[...segments]]/page.tsx` | The public page + `generateMetadata`                                             |
| `scripts/seed.ts`                                                       | Idempotent tenant/admin seed, run via `payload run`                              |
| `tests/setup/env.ts`                                                    | Vitest `setupFiles` entry — sets `DATABASE_URI` before any import                |
| `tests/e2e/tenant-routing.spec.ts`                                      | 10 Playwright tests over the delivery path                                       |
| `tests/integration/content-layer.test.ts`                               | 8 tests over the content functions and the returned shape                        |
| `tests/unit/locales.test.ts`                                            | 15 tests                                                                         |
| `tests/unit/cache-tags.test.ts`                                         | 9 tests                                                                          |

### Changed / removed

| File                                        | Change                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/app/(frontend)/layout.tsx`, `page.tsx` | **Deleted.** Replaced by the `sites/` tree.                                  |
| `vitest.config.ts`                          | Adds `setupFiles: ['tests/setup/env.ts']` and `fileParallelism: false`       |
| `tests/helpers/payload.ts`                  | Tenants gain real `*.localhost` hostnames; district maps to bare `localhost` |
| `package.json`                              | Adds `seed` (`payload run scripts/seed.ts`)                                  |
| `.github/workflows/ci.yml`                  | `e2e` job runs `pnpm run seed` between build and the smoke suite             |
| `src/app/(payload)/admin/importMap.js`      | Regenerated                                                                  |

---

## 2. Request flow

```
Browser
  │  GET http://a.localhost:3000/es/news
  ▼
src/proxy.ts                                    ← matcher decides if this runs at all
  │  normalizeHostname('a.localhost:3000') → 'a.localhost'      [Phase 1: src/lib/tenant.ts]
  │  localeFromPathname('/es/news')        → { locale: 'es', rest: '/news' }
  │  NextResponse.rewrite('/sites/a.localhost/es/news')
  ▼
app/(frontend)/sites/[hostname]/[locale]/layout.tsx
  │  dirFor('es') → 'ltr'
  │  <html lang="es" dir="ltr">
  ▼
app/(frontend)/sites/[hostname]/[locale]/[[...segments]]/page.tsx
  │  getTenantByHostname('a.localhost')                          [src/content/tenants.ts]
  │       └─▶ getPayload({ config }).find({ collection: 'tenants',
  │             where: hostname == X AND status == 'active',
  │             limit: 1, depth: 0, overrideAccess: true })
  │           └─▶ toDomain(doc) → Tenant                         [DD2 domain type]
  │  null → notFound()  ·  otherwise render
  ▼
HTML  (revalidate = 3600)
```

The proxy never touches Payload. It runs on every matched request; the tenant lookup runs at
build and revalidate time only.

The rewrite is what makes the cache key correct: Next caches by pathname, and folding
hostname and locale into the path gives each of the 28 tenants its own entry per route.

---

## 3. `src/proxy.ts`

Next 16's renamed `middleware` convention. Exports `proxy(request: NextRequest)` and a
`config` object.

Body, in order:

1. `normalizeHostname(request.headers.get('host'))`. Falsy → `new NextResponse('Not found', { status: 404 })`.
2. `localeFromPathname(pathname)` → `{ locale, rest }`.
3. If `pathname === '/sites'` or starts with `/sites/` → **404**. This refuses direct
   requests to the rewrite target.
4. Clone `request.nextUrl`, set
   `pathname = /sites/${encodeURIComponent(hostname)}/${locale}${rest === '/' ? '' : rest}`,
   return `NextResponse.rewrite(url)`.

Rewrites do not re-enter the proxy, so step 3 never fires on the rewritten URL.

### The matcher

```js
matcher: [
  '/((?!admin|api|_next|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|css|js|mjs|map|txt|xml|json|woff|woff2|ttf|otf)$).*)',
]
```

Excluded: `/admin` and `/api` (Payload's mount point), `/_next`, and static assets. The
asset exclusion is anchored with `$` to a fixed extension list rather than the common
`.*\..*` form — the rewrite target embeds a hostname, so `/sites/b.localhost/en` contains a
dot and the loose pattern would skip the proxy entirely, leaving step 3 unreachable.
`tests/e2e/tenant-routing.spec.ts` covers this with `refuses a direct /sites/ request`.

`/sites/*` is deliberately **not** excluded — it must reach the proxy to be refused.

---

## 4. `src/lib/locales.ts`

| Export               | Value / signature                                                               |
| -------------------- | ------------------------------------------------------------------------------- |
| `DEFAULT_LOCALE`     | `'en'`                                                                          |
| `TIER_1_LOCALES`     | `['es', 'zh-Hans', 'ko', 'pt', 'ar']`                                           |
| `RTL_LOCALES`        | `['ar']`                                                                        |
| `ALL_LOCALES`        | `[DEFAULT_LOCALE, ...TIER_1_LOCALES]` — six entries                             |
| `isRtlLocale`        | `(locale: string) => boolean`                                                   |
| `dirFor`             | `(locale: string) => 'ltr' \| 'rtl'`                                            |
| `localeFromPathname` | `(pathname: string, enabled = ALL_LOCALES) => { locale: Locale; rest: string }` |
| `localizedPath`      | `(path: string, locale: Locale) => string`                                      |
| `hreflangAlternates` | `(path: string, enabled = ALL_LOCALES) => { hrefLang: string; href: string }[]` |

`localeFromPathname` filters `DEFAULT_LOCALE` out of the candidate set first, so `/en/...`
is not a route — English is served unprefixed. It splits on `/`, tests `segments[1]` against
the candidates, and on a hit returns `rest = '/' + segments.slice(2).join('/')` (collapsing
`'//'` to `'/'`). No match returns `{ locale: 'en', rest: pathname }`, so an unknown prefix
stays part of the path.

Matching is exact and case-sensitive on the script subtag — `zh-Hans` routes, `zh-hans` does
not.

`localizedPath` is the inverse: `en` returns `path` unchanged; anything else returns
`/${locale}${path === '/' ? '' : path}`. `tests/unit/locales.test.ts` asserts the round-trip.

`dirFor` is total — an unknown locale yields `'ltr'` rather than throwing.

`hreflangAlternates` maps every enabled locale through `localizedPath`, then appends
`{ hrefLang: 'x-default', href: localizedPath(path, DEFAULT_LOCALE) }`.

Consumers: `proxy.ts` (`localeFromPathname`), `layout.tsx` (`dirFor`), `page.tsx`
(`ALL_LOCALES`, `localizedPath`, `hreflangAlternates`), `cache-tags.ts` (`DEFAULT_LOCALE`).

---

## 5. `src/content/tenants.ts`

The first module on the Payload side of the boundary that the rendering layer actually
calls. It imports `getPayload` from `payload` and `config` from `@payload-config`, and
returns only DD2 domain types.

```ts
type PayloadTenant = {
  id: string | number
  name: string
  slug: string
  hostname: string
  type: 'district' | 'school'
  status?: 'active' | 'hidden' | null
}

const toDomain = (doc: PayloadTenant): Tenant => ({
  id: String(doc.id),
  slug: doc.slug,
  name: doc.name,
  hostname: doc.hostname,
  type: doc.type,
})
```

`PayloadTenant` is declared locally rather than imported from `src/payload-types.ts`. A
schema regeneration that changes the row shape breaks `toDomain` at compile time instead of
altering the domain type downstream.

`toDomain` drops `status` — it is a query filter, not part of the domain type.

| Function              | Signature                                                        | Query                                                                                 |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `getTenantByHostname` | `(host: string \| null \| undefined) => Promise<Tenant \| null>` | `where: { and: [hostname equals X, status equals 'active'] }`, `limit: 1`, `depth: 0` |
| `listActiveTenants`   | `() => Promise<Tenant[]>`                                        | `where: { status equals 'active' }`, `limit: 1000`, `depth: 0`, `sort: 'slug'`        |

Both pass `overrideAccess: true`. Both run at build/revalidate time, never per visitor.

`getTenantByHostname` calls `normalizeHostname` first and returns `null` immediately when it
yields `null`, so the database is never queried for an unusable host. A hidden tenant and an
unknown tenant are indistinguishable to the caller — both `null`.

`depth: 0` means Payload returns relationship ids rather than populated documents, which is
what keeps the row shape matching `PayloadTenant`.

---

## 6. `src/lib/cache-tags.ts`

Tag construction. No Payload import; no revalidation call sites yet — those arrive with the
Phase 3+ publish hooks.

| Function        | Signature                                              | Output                    |
| --------------- | ------------------------------------------------------ | ------------------------- |
| `tenantTag`     | `(tenantId: string \| number) => string`               | `tenant:<id>`             |
| `documentTag`   | `(collection: string, id: string \| number) => string` | `<collection>:<id>`       |
| `localeTag`     | `(locale: string) => string`                           | `locale:<locale>`         |
| `collectionTag` | `(collection: string) => string`                       | `collection:<collection>` |

Each kind carries its own namespace prefix, so ids from different axes cannot collide.

A module-local `clean(value)` trims and `String()`s, returning `null` for
`null`/`undefined`/empty — every id passes through it before reaching a tag.

```ts
type DocumentTagInput = {
  collection: string
  id: string | number
  tenantId: string | number
  syndicatedTo?: readonly (string | number)[]   // COPE targets
  locales?: readonly string[]
}

tagsForDocument(input: DocumentTagInput): string[]
```

Builds into a `Set`, so duplicates collapse:

1. If `collection` or `id` fails `clean` → return `[]`.
2. Add `collectionTag(collection)` and `documentTag(collection, id)`.
3. Add `tenantTag(tenantId)` if it cleans.
4. Add `tenantTag(t)` for each `syndicatedTo` entry that cleans — the syndication fan-out,
   so an edit purges every tenant rendering the item, not just the owner.
5. Default `locales` to `[DEFAULT_LOCALE]` when absent **or empty**, then for each: add
   `localeTag(locale)` and the compound `<collection>:<id>:<locale>`.

The compound tag is the per-locale artifact handle; the plain `documentTag` covers all
variants at once.

---

## 7. The route tree

### `layout.tsx`

```tsx
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
})
```

Awaits `params`, renders `<html lang={locale} dir={dirFor(locale)}><body>{children}</body></html>`,
and imports `@/styles/globals.css` (which itself `@import`s `tokens.css`). Both `lang` and
`dir` come from the route segment, so they are set for every page under it.

No Payload import — this file is inside Guardrail 1's guarded globs.

### `page.tsx`

```ts
type Params = { hostname: string; locale: string; segments?: string[] }
const pathOf = (segments) => `/${(segments ?? []).join('/')}`
export const revalidate = 3600
```

`generateMetadata({ params })` resolves the tenant via
`getTenantByHostname(decodeURIComponent(hostname))`, returns `{}` when null, otherwise
`title: tenant.name` plus `alternates: { canonical: localizedPath(path, locale), languages: … }`
built from `hreflangAlternates(path)`.

`SitePage({ params })` resolves the tenant the same way and calls `notFound()` when it is
null — an unknown or hidden host 404s rather than falling back to a default tenant.

The rendered body is the Phase 2 scaffold: an `h1` with the tenant name, a `<dl>` exposing
four values under test ids (`tenant-slug`, `tenant-type`, `locale`, `path`), and a
`<nav aria-label="Language">` listing every entry of `ALL_LOCALES` as a link with `lang` and
`hrefLang` set and the endonym as its text, from a module-local `LANGUAGE_NAMES` map
(`English`, `Español`, `简体中文`, `한국어`, `Português`, `العربية`).

`<main data-cache-tag={tenantTag(tenant.id)}>` carries the tag as an attribute. Nothing
consumes it yet; it marks the attachment point for the Phase 3+ revalidation wiring.

`decodeURIComponent` on the hostname pairs with the proxy's `encodeURIComponent`.

---

## 8. Seeding

`scripts/seed.ts` runs under `payload run` (`pnpm run seed`), so it gets config context
without a separate TypeScript runner.

It throws unless `DATABASE_URI` and `PAYLOAD_SECRET` are set, then upserts three tenants **by
`slug`** — find, update if found, create if not. It never truncates.

| slug       | hostname      | type       |
| ---------- | ------------- | ---------- |
| `district` | `localhost`   | `district` |
| `school-a` | `a.localhost` | `school`   |
| `school-b` | `b.localhost` | `school`   |

Matching on `slug` rather than `hostname` lets routing configuration change without creating
a duplicate row.

A district-admin is created only when both `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are
set, and only when no user with that email exists. With neither set, it logs and skips —
there is no default credential.

Bare `localhost` maps to the district because Playwright's `webServer.url` readiness check
requests `http://localhost:3000`, and an unresolvable host 404s.

CI runs `pnpm run seed` in the `e2e` job between `pnpm build` and the smoke suite.

---

## 9. Test environment

`tests/setup/env.ts` is registered as a Vitest `setupFiles` entry:

```ts
process.env.DATABASE_URI =
  process.env.TEST_DATABASE_URI ?? 'postgres:///dd2_test?host=/var/run/postgresql'
process.env.PAYLOAD_SECRET ??= 'test-only-secret-not-used-in-any-environment'
```

It has to run at setup rather than inside a helper: `src/payload.config.ts` reads
`process.env` at module evaluation, and any test importing a content-layer function pulls
the config in transitively at import time — before the first line of the test body.

`fileParallelism: false` is set in the same commit. Integration files share one Postgres and
each calls `seed()`, which deletes and recreates fixtures; parallel files race on the unique
tenant `slug`.

---

## 10. Tests

### `tests/unit/locales.test.ts` — 15 cases

Locale tiers (English is the source locale; the five Tier 1 locales; Arabic is RTL);
`localeFromPathname` (unprefixed default, prefix extraction and stripping, the script-tagged
`zh-Hans` case, an unknown prefix staying in the path, case sensitivity, restriction to a
supplied `enabled` set); `dirFor`/`isRtlLocale` including the unknown-locale default;
`localizedPath` including the round-trip against `localeFromPathname`.

### `tests/unit/cache-tags.test.ts` — 9 cases

Tag construction (namespacing, string/number id stability, readability) and `tagsForDocument`
(document + tenant + collection tags; a tag per locale; the syndication fan-out;
deduplication when a syndication target repeats the owning tenant; defaulting to the source
locale; never emitting an empty or malformed tag).

### `tests/integration/content-layer.test.ts` — 8 cases

Against real Postgres via `getTestPayload` + `seed`.

- `getTenantByHostname`: resolves a known host; normalizes case, port and trailing dot before
  matching; returns `null` for an unknown host; does not resolve a hidden tenant.
- The boundary: the returned object is exactly the DD2 `Tenant` shape with no Payload fields
  leaking (`status`, `createdAt`, `updatedAt` absent); `id` is a string; every item from
  `listActiveTenants` has the same shape; hidden tenants are excluded.

The shape assertions are what keep the boundary honest at runtime — Guardrail 1 stops the
rendering layer _importing_ Payload, and these stop Payload's fields _arriving_ through the
content layer.

### `tests/e2e/tenant-routing.spec.ts` — 10 cases

Driven against real `*.localhost` hostnames, which resolve to loopback per RFC 6761 — no
`/etc/hosts` entry needed. Each `describe` sets its own base URL:

```ts
const site = (host: string) => ({ baseURL: `http://${host}:${PORT}` })
test.describe('tenant resolution by Host', () => {
  test.use(site('a.localhost')) /* … */
})
```

The `Host` header cannot be overridden instead — browsers treat it as forbidden and Chromium
rejects the request.

| Test                                                     | Tags           |
| -------------------------------------------------------- | -------------- |
| resolves the correct tenant                              | `@smoke`       |
| defaults to the source locale on an unprefixed path      | `@smoke`       |
| does not receive tenant A from a shared cache entry      | `@smoke`       |
| serves a Tier 1 locale under its path prefix             | `@smoke`       |
| sets `dir="rtl"` for Arabic                              | `@smoke @rtl`  |
| treats an unknown prefix as a path, not a locale         | `@smoke`       |
| language switcher lists each language in its own script  | `@smoke`       |
| a localized page has zero critical or serious violations | `@smoke @a11y` |
| 404 rather than falling back to a default tenant         | `@smoke`       |
| refuses a direct `/sites/` request                       | `@smoke`       |

The cross-tenant cache test is the one that would catch a regression in the rewrite. It sits
in its own `describe` with `test.use(site('b.localhost'))`, requests `/` — the same path the
preceding block requested against `a.localhost` — and asserts `tenant-slug` reads `school-b`.
A shared cache entry per path would return `school-a` here. The last test covers the
matcher's anchored extension list.

---

## 11. Connections and seams

**Backward:**

| Uses                                 | From                                                    |
| ------------------------------------ | ------------------------------------------------------- |
| `normalizeHostname`                  | Phase 1 `src/lib/tenant.ts` — proxy and content layer   |
| `tenants.hostname`, `tenants.status` | Phase 1 collection — the routing query                  |
| `Tenant`, `Locale` types             | Phase 0 `src/content/types.ts`                          |
| `globals.css` → `tokens.css`         | Phase 0 styles, imported once by `layout.tsx`           |
| Guardrail 1                          | Phase 0 — the new `(frontend)/sites/**` tree is guarded |
| `chromium-rtl` project               | Phase 0 — first real `@rtl` route test lands here       |
| `getTestPayload` / `seed`            | Phase 1 harness, extended with real hostnames           |

**Forward:**

| Seam                             | Consumer                                                                  |
| -------------------------------- | ------------------------------------------------------------------------- |
| `[[...segments]]` catch-all      | Phase 3 — resolves segments to a page instead of echoing the path         |
| `data-cache-tag` on `<main>`     | Phase 3+ — publish hooks call `revalidateTag` with `tagsForDocument(...)` |
| `tagsForDocument.syndicatedTo`   | Phase 5 — COPE syndication fan-out                                        |
| `tagsForDocument.locales`        | Phase 7 — per-locale artifacts                                            |
| `listActiveTenants`              | Phase 3 — `generateStaticParams` for all 28 sites                         |
| `src/content/index.ts`           | Phase 3+ — `pages.ts`, `posts.ts`, `events.ts`, … alongside `tenants.ts`  |
| `LANGUAGE_NAMES` + the `<nav>`   | Phase 7 — replaced by the real language switcher component                |
| `TIER_1_LOCALES` / `ALL_LOCALES` | Phase 7 — Tier 2 locales come from `settings.enabledLocales` at runtime   |
