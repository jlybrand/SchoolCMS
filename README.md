# DD2 Website Platform

District-owned, accessibility-native web platform serving one district domain and 27 school
subdomains — **28 tenants from a single codebase and deployment**. Replaces the rented
Finalsite Composer CMS.

Design documentation lives in [`starterDocs/`](./starterDocs/00-README.md) and is the
specification. Working conventions for this repo are in [`CLAUDE.md`](./CLAUDE.md).

**Status: Phase 0 complete** — scaffold and guardrails (`starterDocs/05-build-order-roadmap.md`).

## Requirements

| Tool     | Version | Notes                                                   |
| -------- | ------- | ------------------------------------------------------- |
| Node     | 24.19.0 | Active LTS (Krypton). `.nvmrc` pins it; Node 20 is EOL. |
| pnpm     | 11.20.0 | Provisioned by corepack from `packageManager`.          |
| Postgres | 18      | Any recent major works locally; **never MongoDB**.      |

`engine-strict=true` means the install fails loudly rather than half-working on the wrong
Node. That is intentional.

## Setup

```bash
nvm use                 # or: nvm install 24.19.0
corepack enable
pnpm install

cp .env.example .env    # then fill in PAYLOAD_SECRET and DATABASE_URI
```

### Database

With a container runtime:

```bash
pnpm db:up              # Postgres 18 on localhost:5433
```

Without one, any local Postgres works — only the connection string matters:

```bash
createdb dd2_dev
# DATABASE_URI=postgres:///dd2_dev?host=/var/run/postgresql
```

### Run

```bash
pnpm dev                # public site at :3000, Payload admin at :3000/admin
```

## The two Phase 0 guardrails

Both are CI-blocking, and both have tests that prove the guard itself still fires — a rule
that has silently stopped matching is worse than no rule, because the claim it backs keeps
being made.

**1. The content-access layer boundary** (`02` §11, ADR-5)

The public rendering layer never imports the Payload SDK; it calls `src/content/*`, which
returns hand-written DD2 domain types. This is what keeps the CMS replaceable — swapping it
means rewriting ~8 files, not ~200 components. Enforced by ESLint over
`src/app/(frontend)/`, `src/components/`, `src/blocks/`.

`src/app/(payload)/` is Payload's own mount point and is exempt; see the scope note in
`eslint.config.mjs`.

**2. CSS logical properties only** (`07` §3, `08` §7)

Stylelint rejects `margin-left`, `text-align: left`, `width`, `top` and every physical
sibling. Use `margin-inline-start`, `text-align: start`, `inline-size`, `inset-block-start`.
RTL correctness is structural — nearly free from the first component, expensive to retrofit
across a finished library.

Plus the **failing-closed axe gate**: zero critical/serious violations to merge, wired
before any feature exists so the bar is never "added later".

```bash
pnpm test:unit          # includes tests/unit/guardrails
pnpm test:e2e:smoke     # includes the "axe gate fails closed" proof
```

## Full gate

Order matches `starterDocs/06-testing-strategy.md` §3 — fail fast.

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e:smoke
```

## Phase 0 exit criteria — met

- [x] Green CI on an empty app
- [x] Axe gate wired and **failing-closed** (proven by test, not asserted)
- [x] Content-access boundary lint guard active, with exemption pinned by test
- [x] Logical-properties lint guard active
- [x] `.env` contract documented (`.env.example`)
- [x] Design tokens and base theme, logical properties only

## Next: Phase 1 — tenancy, auth & access control

`tenants` and `users` collections, `plugin-multi-tenant`, Entra ID OIDC, and the
**adversarial cross-tenant isolation suite**. Because isolation is enforced in Payload's
access functions rather than in the database, that suite is the primary guarantee, not a
secondary check (`03` §6.4).
