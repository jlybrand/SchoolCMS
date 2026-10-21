import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { buildConfig } from 'payload'

import { isDistrictAdmin } from './access/predicates'
import type { AuthUser } from './access/types'
import { Navigation } from './collections/Navigation'
import { Pages } from './collections/Pages'
import { Settings } from './collections/Settings'
import { Tenants } from './collections/Tenants'
import { Theme } from './collections/Theme'
import { Users } from './collections/Users'
import { constrainedEditor } from './lib/editor'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Payload 3, pinned (ADR-4). The plugin surface is deliberately minimal — every plugin is a
 * swap cost (`02` §2). Phase 6 adds cloud storage for R2. `plugin-seo` was evaluated in Phase 3
 * and NOT adopted — see the `meta` group in src/collections/Pages.ts for why.
 * Nothing else is adopted without weighing its contribution to the switching cost.
 */
export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
  },

  collections: [Tenants, Users, Pages, Navigation, Theme, Settings],

  // Postgres, never Mongo — portability is a hard requirement (`00`, ADR-10).
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URI ?? '' },
  }),

  /**
   * Constrained rich text (`07` §4.4) — an accessibility control and a security control
   * simultaneously. The feature allowlist and the reasoning behind every exclusion live in
   * src/lib/editor.ts, guarded by tests/unit/editor.test.ts.
   *
   * Set GLOBALLY rather than per field, so a rich-text field added later is constrained by
   * default. A field that had to opt in is a field someone can forget to opt in.
   */
  editor: constrainedEditor(),

  plugins: [
    /**
     * Multi-tenancy (`02` §4.2). The plugin adds the `tenant` relationship to tenant-owned
     * collections and the `tenants` array to users, and applies base filters.
     *
     * IMPORTANT — what this plugin is and is not. It is scoping convenience, NOT the
     * isolation guarantee. Because Payload owns the connection and Postgres RLS is
     * unavailable (`02` §4.2), isolation rests on the access functions in `src/access/`
     * plus the adversarial suite that exercises them over every route. The plugin's
     * `useTenantAccess` is left on so its constraints compose with ours, but the suite
     * asserts denial independently of it — if the plugin changed behaviour on upgrade, the
     * tests must fail rather than the isolation quietly weakening.
     */
    multiTenantPlugin<{ user: AuthUser }>({
      tenantsSlug: 'tenants',
      // district-admin works across all 28 sites by design (`04` §3.2).
      userHasAccessToAllTenants: (user) => isDistrictAdmin(user),
      collections: {
        /**
         * Registering here is what injects the `tenant` relationship field — which is why
         * src/collections/Pages.ts does not declare one. The remaining tenant-owned
         * collections join as they land: posts, events, people, documents, media, alerts,
         * redirects.
         */
        pages: {},
        /**
         * `isGlobal` is how a per-tenant "global" (`03` §5) is expressed under this plugin: a
         * Payload global is one document for the whole install, and there are 28 sites. It
         * makes the injected `tenant` field UNIQUE — one row per site, refused by the
         * database rather than by a hook — and has the admin open that row directly instead
         * of a list of one. `theme` and `settings` are registered the same way.
         */
        navigation: { isGlobal: true },
        theme: { isGlobal: true },
        settings: { isGlobal: true },
      },
    }),
  ],

  secret: process.env.PAYLOAD_SECRET ?? '',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },

  // Generated migrations are reviewed and applied as a guarded, reversible step;
  // expand/contract only, tested up and down in CI (`09` §2).
  ...(process.env.NODE_ENV === 'production'
    ? { migrationDir: path.resolve(dirname, '../migrations') }
    : {}),
})
