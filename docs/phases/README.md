# Phase documentation

One document per build phase, describing **how that phase works mechanically** — what each
file does, which functions call which, what data flows where, and how the phase connects to
the ones before it.

These are functional maps, not design documents. The reasoning behind every decision lives
in `starterDocs/` and `CLAUDE.md`; it is deliberately not repeated here.

| Doc                            | Phase                                   | Modules covered                                                  |
| ------------------------------ | --------------------------------------- | ---------------------------------------------------------------- |
| `00-setup-and-guardrails.md`   | Phase 0 — scaffold + guards             | build config, both lint guardrails, CI, styles, Payload mount    |
| `01-tenancy-auth-access.md`    | Phase 1 — tenancy, auth, access control | `src/access/`, `src/auth/`, `tenants`/`users`, isolation suite   |
| `02-delivery-content-layer.md` | Phase 2 — delivery + content layer      | proxy routing, `src/content/`, cache tags, locales, public route |

A phase's document is written or updated as part of that phase's PR.
