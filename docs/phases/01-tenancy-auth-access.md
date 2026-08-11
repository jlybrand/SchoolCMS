# Phase 1 — Tenancy, authentication and access control

How the access layer works: the role and tenant primitives, the Payload access functions
built on them, the two collections that consume them, the Entra mapping, the interim
local-auth pieces, and the adversarial isolation suite.

Commits: `0c0c06c` (tenancy, access, isolation suite), `7a0d6c5` (interim local auth).

---

## 1. File inventory

### `src/access/` — the security core

| File               | Exports                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`         | `Role`, `ROLES`, `TenantRef`, `AuthUser`                                                                                                             |
| `predicates.ts`    | `hasRole`, `isDistrictAdmin`, `isSchoolManager`, `isSystemSync`, `tenantIdOf`, `tenantIdsFor`, `hasTenant`                                           |
| `tenant-scoped.ts` | `tenantReadAccess`, `tenantCreateAccess`, `tenantWriteAccess`, `districtOnly`, `districtOnlyField`, `denyAllField`, `denyAll`, `selfOrDistrictAdmin` |

### `src/auth/`

| File                 | Exports                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `entra-mapping.ts`   | `EntraGroupMap`, `mapEntraGroupsToRoles`, `groupMapFromEnv`      |
| `password-policy.ts` | `MIN_PASSWORD_LENGTH`, `MAX_PASSWORD_LENGTH`, `validatePassword` |

### Collections, lib, config

| File                         | Job                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `src/collections/Tenants.ts` | The `tenants` collection — six fields, four access rules.                          |
| `src/collections/Users.ts`   | The `users` auth collection — extended from Phase 0 with roles, tenancy and seams. |
| `src/lib/tenant.ts`          | `normalizeHostname` — pure hostname normalization, no database.                    |
| `src/payload.config.ts`      | Registers `Tenants`, mounts `multiTenantPlugin`.                                   |
| `src/payload-types.ts`       | Generated, committed. CI proves it current.                                        |

### Tests

| File                                         | Layer       | Covers                                                      |
| -------------------------------------------- | ----------- | ----------------------------------------------------------- |
| `tests/unit/access/predicates.test.ts`       | unit        | 15 cases over role and tenant primitives                    |
| `tests/unit/access/tenant-scoped.test.ts`    | unit        | 23 cases over the access functions                          |
| `tests/unit/access/entra-mapping.test.ts`    | unit        | 7 cases over the group allowlist                            |
| `tests/unit/access/password-policy.test.ts`  | unit        | 10 cases over `validatePassword`                            |
| `tests/unit/tenant-resolution.test.ts`       | unit        | 7 cases over `normalizeHostname`                            |
| `tests/integration/tenant-isolation.test.ts` | integration | 22 cases in four groups, against real Postgres              |
| `tests/integration/local-auth.test.ts`       | integration | 10 cases over login, policy enforcement, credential leakage |
| `tests/helpers/payload.ts`                   | harness     | `getTestPayload`, `seed`, `isDenied`, `readsNothing`        |

---

## 2. Dependency flow

Nothing in `src/access/` imports a collection; the arrows run one way.

```
        types.ts
           │  Role, AuthUser, TenantRef
           ▼
      predicates.ts ──────────────────┐
           │  isDistrictAdmin,        │ isDistrictAdmin
           │  tenantIdsFor, tenantIdOf│
           ▼                          ▼
     tenant-scoped.ts          payload.config.ts
           │                   (multiTenantPlugin →
           │                    userHasAccessToAllTenants)
           ├──────────────┐
           ▼              ▼
   collections/       collections/
     Tenants.ts         Users.ts ◀── auth/password-policy.ts
                                      (validatePassword, via beforeValidate)

  auth/entra-mapping.ts ── types.ts only. No caller yet; wired at the Entra switch.
  lib/tenant.ts ────────── no imports. Called by Phase 2's proxy + content layer.
```

`types.ts` declares `AuthUser` as a hand-written structural type rather than importing
Payload's generated `User`, so the whole `src/access/` tree compiles without the SDK.

---

## 3. `src/access/types.ts`

```ts
type Role = 'district-admin' | 'school-manager' | 'system-sync'
const ROLES: readonly Role[] = ['district-admin', 'school-manager', 'system-sync']

type TenantRef = string | number | { id: string | number }

type AuthUser = {
  id: string | number
  roles?: Role[] | null
  tenants?: { tenant?: TenantRef | null }[] | null
}
```

Roles are flat — no role contains another. `TenantRef` covers both shapes Payload returns:
a bare id at `depth: 0`, a populated document otherwise. The `tenants` array shape is the
one `@payloadcms/plugin-multi-tenant` adds to the users collection.

`ROLES` is consumed once, by `Users.ts`, to build the `roles` select options:
`ROLES.map((value) => ({ label: value, value }))`.

---

## 4. `src/access/predicates.ts`

Every function denies on absent or malformed input.

| Function                   | Signature                                                 | Behaviour                                                                            |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `rolesOf` _(module-local)_ | `(user) => Role[]`                                        | `Array.isArray(user?.roles) ? user.roles : []`                                       |
| `hasRole`                  | `(user, role) => boolean`                                 | `rolesOf(user).includes(role)` — exact match, no case folding or prefix matching     |
| `isDistrictAdmin`          | `(user) => boolean`                                       | `hasRole(user, 'district-admin')`                                                    |
| `isSchoolManager`          | `(user) => boolean`                                       | `hasRole(user, 'school-manager')`                                                    |
| `isSystemSync`             | `(user) => boolean`                                       | `hasRole(user, 'system-sync')`                                                       |
| `tenantIdOf`               | `(ref: TenantRef \| null \| undefined) => string \| null` | Normalizes to a string id; `null` for absent, empty string, or unrecognized shape    |
| `tenantIdsFor`             | `(user) => string[]`                                      | Maps `user.tenants` through `tenantIdOf`, dropping every `null`                      |
| `hasTenant`                | `(user, tenant) => boolean`                               | `tenantIdsFor(user).includes(tenantIdOf(tenant))`; `false` when the target is `null` |

`tenantIdOf` handles four cases in order: `null`/`undefined` → `null`; `string` → itself
unless empty; `number` → `String(n)`; object with `id` → `String(id)` unless the id is
`null`/`undefined`/`''`. Anything else → `null`.

Ids are compared as strings throughout, which is what lets a numeric Postgres id and a
string query parameter agree. `hasTenant` does **not** special-case `district-admin` — the
cross-tenant grant is written explicitly in each access function instead.

`isDistrictAdmin` has two consumers outside this directory: `tenant-scoped.ts`, and
`payload.config.ts`, where it is the `userHasAccessToAllTenants` callback for the
multi-tenant plugin.

---

## 5. `src/access/tenant-scoped.ts`

All eight exports are Payload `Access` or `FieldAccess` functions. A shared local helper
pulls the user off the request:

```ts
const userOf = (req: { user?: unknown }): AuthUser | null => (req?.user as AuthUser) ?? null
```

The load-bearing property: **reads and writes return a query constraint, never `true`, for
a scoped user.**

| Export                | Type          | anonymous | district-admin | scoped user                     | scoped, no tenants |
| --------------------- | ------------- | --------- | -------------- | ------------------------------- | ------------------ |
| `tenantReadAccess`    | `Access`      | `false`   | `true`         | `{ tenant: { in: [...ids] } }`  | `false`            |
| `tenantCreateAccess`  | `Access`      | `false`   | `true`         | `allowed.includes(data.tenant)` | `false`            |
| `tenantWriteAccess`   | `Access`      | `false`   | `true`         | `{ tenant: { in: [...ids] } }`  | `false`            |
| `districtOnly`        | `Access`      | `false`   | `true`         | `false`                         | `false`            |
| `districtOnlyField`   | `FieldAccess` | `false`   | `true`         | `false`                         | `false`            |
| `denyAllField`        | `FieldAccess` | `false`   | `false`        | `false`                         | `false`            |
| `denyAll`             | `Access`      | `false`   | `false`        | `false`                         | `false`            |
| `selfOrDistrictAdmin` | `Access`      | `false`   | `true`         | `{ id: { equals: user.id } }`   | same               |

Details that matter mechanically:

- **Empty tenant list returns `false`, not `{ tenant: { in: [] } }`.** An empty `in` is
  droppable by a query builder; `false` is not.
- **`tenantCreateAccess` is the only one reading `data`.** A create has no existing
  document, so it judges the incoming `data.tenant` via `tenantIdOf`. A `null` result denies.
- **`tenantWriteAccess` ignores `data` entirely.** Payload's access args carry `id` and
  `data` but not the stored document, so update/delete return a constraint and let the
  database decide reachability. Tenant _reassignment_ is gated separately, at field level.
- **`districtOnly` and `districtOnlyField` are separate exports with the same body.**
  `Access` may return `boolean | Where`; `FieldAccess` must return `boolean`. They are not
  aliased to each other.

---

## 6. Collections

### `tenants` (`src/collections/Tenants.ts`)

One document per site. Nothing in the collection encodes the count of 28.

| Field                   | Type     | Attributes                                          |
| ----------------------- | -------- | --------------------------------------------------- |
| `name`                  | `text`   | required                                            |
| `slug`                  | `text`   | required, unique, indexed                           |
| `hostname`              | `text`   | required, unique, indexed — the routing key         |
| `type`                  | `select` | required, default `school`; `school` \| `district`  |
| `status`                | `select` | required, default `active`; `active` \| `hidden`    |
| `powerSchoolBuildingId` | `text`   | indexed, optional — seam for the Phase 5 staff sync |

Access: `create`/`update`/`delete` are `districtOnly`. `read` is written inline rather than
reusing `tenantReadAccess`, because the scoping field is `id`, not `tenant`:

```ts
read: ({ req }) => {
  const user = (req?.user as AuthUser) ?? null
  if (!user) return false
  if (isDistrictAdmin(user)) return true
  const ids = tenantIdsFor(user)
  if (ids.length === 0) return false
  return { id: { in: ids } }
}
```

No anonymous read is granted. Phase 2's public path reaches tenants through
`src/content/tenants.ts` with `overrideAccess: true` instead.

Admin config: `useAsTitle: 'name'`, `defaultColumns: ['name','hostname','type','status']`,
`group: 'Administration'`.

### `users` (`src/collections/Users.ts`)

Payload's auth collection. The `tenants` array field is injected by the multi-tenant plugin
and is not declared here.

```ts
auth: { tokenExpiration: 60 * 60 * 8, maxLoginAttempts: 5, lockTime: 10 * 60 * 1000 }
```

| Field           | Type                        | Field-level `update` access | Notes                                                        |
| --------------- | --------------------------- | --------------------------- | ------------------------------------------------------------ |
| `name`          | `text`                      | —                           |                                                              |
| `entraObjectId` | `text`, unique, indexed     | `denyAllField`              | `readOnly`. Unused under local auth; the Entra linking seam. |
| `roles`         | `select`, hasMany, required | `districtOnlyField`         | Options from `ROLES`; default `[]`                           |
| `defaultTenant` | `relationship` → `tenants`  | `districtOnlyField`         |                                                              |
| `autoApprove`   | `select`, hasMany           | `districtOnlyField`         | Default `[]`. Options: `events:schedule`, `posts:routine`    |
| `isBreakGlass`  | `checkbox`                  | `denyAllField`              | `readOnly`, default `false`                                  |
| `lastLoginAt`   | `date`                      | `denyAllField`              | `readOnly`                                                   |

Collection access: `read: selfOrDistrictAdmin`; `create`, `update`, `delete`, `unlock` all
`districtOnly`. Update being district-only is what makes every field above unreachable to a
school-manager on their own record.

`autoApprove` is inert at this phase — the field stores values, and nothing reads them. The
enforcement lands with the Phase 4 approval workflow.

#### The password hook

`Users.hooks.beforeValidate` holds one function:

```ts
;({ data }) => {
  const password = data?.password
  if (password === undefined || password === null || password === '') return data
  const result = validatePassword(password)
  if (result !== true)
    throw new ValidationError({ errors: [{ path: 'password', message: result }] })
  return data
}
```

Because it is a hook rather than field validation, it applies on the REST, GraphQL and Local
API paths alike. The early return is what lets an update that touches other fields pass
without supplying a password. This hook and its import are deleted at the Entra switch.

---

## 7. `src/payload.config.ts` changes

Two additions over Phase 0:

```ts
collections: [Tenants, Users],

plugins: [
  multiTenantPlugin<{ user: AuthUser }>({
    tenantsSlug: 'tenants',
    userHasAccessToAllTenants: (user) => isDistrictAdmin(user),
    collections: {},   // content collections register here from Phase 3
  }),
],
```

The plugin adds the `tenant` relationship to registered collections and the `tenants` array
to `users`, and contributes its own base filters. `collections` is empty at this phase, so
the only thing the plugin currently shapes is the users array field. The functions in
`src/access/` are separate from the plugin's filters and are asserted independently by the
isolation suite.

---

## 8. `src/auth/entra-mapping.ts`

Pure functions, no caller yet.

```ts
type EntraGroupMap = Record<string, Role>

mapEntraGroupsToRoles(
  groups: readonly unknown[] | null | undefined,
  groupMap: EntraGroupMap | null | undefined,
): Role[]

groupMapFromEnv(env: NodeJS.ProcessEnv = process.env): EntraGroupMap
```

Two module-local constants:

```ts
const NEVER_VIA_LOGIN: readonly Role[] = ['system-sync']
const ROLE_ORDER: readonly Role[] = ['district-admin', 'school-manager', 'system-sync']
```

`mapEntraGroupsToRoles` walks `groups`, skipping non-strings and empty-after-trim entries.
Membership is tested with `Object.prototype.hasOwnProperty.call(groupMap, key)`, so
prototype keys cannot match. Any role in `NEVER_VIA_LOGIN` is dropped even on an exact
group hit. Results accumulate in a `Set`, then emit as
`ROLE_ORDER.filter((role) => granted.has(role))` — deduplicated and order-stable regardless
of claim order. A non-array `groups` or absent `groupMap` returns `[]`.

`groupMapFromEnv` reads `ENTRA_GROUP_DISTRICT_ADMIN` and `ENTRA_GROUP_SCHOOL_MANAGER`,
trims each, and adds an entry only for non-empty values. No `system-sync` key is ever built.

---

## 9. `src/auth/password-policy.ts`

```ts
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 256
validatePassword(value: unknown): true | string
```

Returns `true` or a plain-language message. Checks run in order:

1. Non-string or empty → `'Please enter a password.'`
2. Trim, then count length as `[...trimmed].length` — code points, so astral characters
   count as one.
3. Below `MIN_PASSWORD_LENGTH` → message naming the minimum.
4. Above `MAX_PASSWORD_LENGTH` → message naming the maximum, before any hashing.
5. Lowercase, then reject if it contains any of eight `WEAK_FRAGMENTS` as a substring:
   `password`, `123456`, `qwerty`, `letmein`, `welcome`, `admin`, `dd2`, `district`.
6. Reject if `new Set([...trimmed]).size < 5` — fewer than five distinct characters.

No character-class rules. Only caller: the `Users` `beforeValidate` hook. The `dd2` and
`district` fragments constrain test fixtures — `tests/helpers/payload.ts` uses
`SEED_PASSWORD = 'seed-otter-marble-91'` to satisfy the policy.

---

## 10. `src/lib/tenant.ts`

```ts
normalizeHostname(host: string | null | undefined): string | null
```

The only function in the module, and it touches no database. Order of operations:

1. Non-string → `null`.
2. `trim().toLowerCase()`; empty → `null`.
3. **IPv6 branch** — if it starts with `[`, find `]`; missing → `null`; otherwise return
   through the bracket, discarding any `:port` after it. `'[]'` → `null`.
4. Otherwise split on `:` and take segment 0.
5. Strip a single trailing dot.
6. Empty result → `null`.

`null` means unusable, and every caller refuses rather than substituting a default. Phase 2
adds both callers: `src/proxy.ts` (404s) and `src/content/tenants.ts` (returns `null`, and
the page component calls `notFound()`).

---

## 11. Unit test structure

`tests/unit/access/tenant-scoped.test.ts` builds fake request objects rather than booting
Payload, so it runs with no database. The recurring assertion shape is that a scoped user
receives an object, never `true`:

```ts
expect(tenantReadAccess({ req: { user: managerA } })).toEqual({ tenant: { in: ['1'] } })
```

Cases are table-driven across role × tenant assignment, and each function is exercised for:
district-admin, single-tenant manager, multi-tenant manager, manager with **no** tenants,
`system-sync`, and anonymous.

`predicates.test.ts` covers the malformed-input surface directly — lookalike role strings,
`null` rows inside `tenants`, populated relationship objects, numeric-vs-string id
equivalence, and that `district-admin` does not implicitly satisfy `hasTenant` or the other
role predicates.

---

## 12. The integration harness

`tests/helpers/payload.ts` boots the real config against a disposable Postgres.

| Export              | Signature                        | Behaviour                                                                                                              |
| ------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `TEST_DATABASE_URI` | `string`                         | `process.env.TEST_DATABASE_URI` or `postgres:///dd2_test?host=/var/run/postgresql`                                     |
| `SEED_PASSWORD`     | `string`                         | `'seed-otter-marble-91'`                                                                                               |
| `getTestPayload`    | `() => Promise<Payload>`         | Sets env, then **dynamically** imports `payload` and `@payload-config`; caches the instance in a module-level `cached` |
| `seed`              | `(payload) => Promise<Fixtures>` | Deletes `users` then `tenants`, recreates three tenants and five users                                                 |
| `isDenied`          | `(fn) => Promise<boolean>`       | `true` if the promise rejects                                                                                          |
| `readsNothing`      | `(fn) => Promise<boolean>`       | `true` if it rejects **or** resolves with `docs.length === 0`                                                          |

The imports inside `getTestPayload` are dynamic because the config reads `process.env` at
module evaluation; a static import would evaluate it before the assignments above run.

`readsNothing` accepts both outcomes deliberately: a `false` access result makes Payload
throw `Forbidden`, while a constraint that matches nothing returns an empty list. Both mean
no rows reached the caller.

### Fixtures

```ts
type Fixtures = {
  tenantA: number
  tenantB: number
  districtAdmin: TypedUser
  managerA: TypedUser
  managerB: TypedUser
  systemSync: TypedUser
  noTenantManager: TypedUser
}
```

| Tenant    | slug       | hostname      | type       |
| --------- | ---------- | ------------- | ---------- |
| district  | `district` | `localhost`   | `district` |
| `tenantA` | `school-a` | `a.localhost` | `school`   |
| `tenantB` | `school-b` | `b.localhost` | `school`   |

| User              | email                       | roles            | tenants   |
| ----------------- | --------------------------- | ---------------- | --------- |
| `districtAdmin`   | `district-admin@test.local` | `district-admin` | district  |
| `managerA`        | `manager-a@test.local`      | `school-manager` | `tenantA` |
| `managerB`        | `manager-b@test.local`      | `school-manager` | `tenantB` |
| `systemSync`      | `system-sync@test.local`    | `system-sync`    | `tenantA` |
| `noTenantManager` | `no-tenant@test.local`      | `school-manager` | _(none)_  |

Tenant ids are `number` — Postgres serials. The access layer's string normalization is what
keeps that off the security path.

Ordering constraints: `seed` deletes `users` before `tenants` because users reference
tenants; the hostnames are `*.localhost` so Phase 2's Playwright suite can drive them
without DNS or `/etc/hosts`.

---

## 13. The isolation suite

`tests/integration/tenant-isolation.test.ts` — 22 tests in four groups, run against real
Postgres through the real config.

**Invariant 1 — cannot READ another tenant** (7): manager A sees only tenant A; cannot read
tenant B by direct id; a no-tenant manager reads nothing; anonymous reads nothing;
district-admin reads across all tenants; a hand-crafted `where` clause cannot widen scope
past the constraint; sorting and pagination cannot surface another tenant.

**Invariant 2 — cannot WRITE into another tenant** (6): manager A cannot update, delete, or
create; **bulk** update and **bulk** delete cannot reach across; anonymous cannot create.
The bulk cases are the ones that exercise the constraint-not-boolean property directly — a
`where: {}` bulk operation is intersected with the returned constraint rather than granted
wholesale.

**Invariant 4 — the surface never leaks user records** (4): anonymous cannot list users; a
school-manager sees only their own record and cannot read another by direct id;
district-admin can enumerate.

**Privilege escalation** (5): a school-manager cannot grant themselves `district-admin`,
cannot assign themselves another tenant, cannot grant themselves an `autoApprove` scope;
`autoApprove` is empty for every seeded user, so nothing defaults it by role or tenant; and
`system-sync` cannot escalate its own role.

`vitest.config.ts` sets `fileParallelism: false` — integration files share one database and
each calls `seed()`, which deletes and recreates fixtures.

---

## 14. The local-auth suite

`tests/integration/local-auth.test.ts` — 10 cases in three groups (7 `it` plus one 3-row `it.each`).

- **login** (3): correct credentials succeed and return the user with `roles` intact; a wrong
  password fails; an unknown account fails.
- **policy enforced on the API, not just the form** (6): an `it.each` rejects three weak
  shapes on create — too short, a common word, no variety — then a compliant password is
  accepted, a weak password is rejected on **update** as well as create, and an update
  supplying no password leaves unrelated fields untouched.
- **credentials never exposed** (1): a read returns no `password`, salt or hash material.

The second group is what proves the `beforeValidate` placement — these calls go through the
Local API, bypassing the admin form entirely.

---

## 15. Connections and seams

**Backward, to Phase 0:**

- `src/access/**` and `src/auth/**` sit outside Guardrail 1's guarded globs. They import
  `payload` types freely; nothing in them reaches the rendering layer.
- `Tenants.ts` and `Users.ts` import through the `@/` alias defined in `tsconfig.json` and
  mirrored in `vitest.config.ts`.
- `src/payload-types.ts` is regenerated by the `static` CI job and diffed.
- `AuthUser` in `types.ts` deliberately shadows part of the generated `User`, so
  regeneration cannot silently reshape the predicates' input.

**Forward:**

| Seam                                      | Consumer                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `normalizeHostname`                       | Phase 2 — `src/proxy.ts` and `src/content/tenants.ts`                                              |
| `tenants.hostname` / `status`             | Phase 2 — `getTenantByHostname` queries both                                                       |
| `multiTenantPlugin.collections`           | Phase 3+ — each content collection registers as it lands                                           |
| `tenantReadAccess` and siblings           | Phase 3+ — attached to each content collection; a separate public-read function is added alongside |
| `users.autoApprove`                       | Phase 4 — the grant mechanism reads it                                                             |
| `tenants.powerSchoolBuildingId`           | Phase 5 — building → tenant mapping for the staff sync                                             |
| `users.entraObjectId`, `entra-mapping.ts` | The Entra switch — the OIDC strategy calls `mapEntraGroupsToRoles` and populates `entraObjectId`   |
| `password-policy.ts` + the hook           | Deleted at the Entra switch                                                                        |
