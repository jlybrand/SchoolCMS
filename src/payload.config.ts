import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { isDistrictAdmin } from './access/predicates'
import type { AuthUser } from './access/types'
import { Pages } from './collections/Pages'
import { Tenants } from './collections/Tenants'
import { Users } from './collections/Users'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Payload 3, pinned (ADR-4). The plugin surface is deliberately minimal — every plugin is a
 * swap cost (`02` §2). Phase 3 adds `plugin-seo`; Phase 6 adds cloud storage for R2.
 * Nothing else is adopted without weighing its contribution to the switching cost.
 */
export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
  },

  collections: [Tenants, Users, Pages],

  // Postgres, never Mongo — portability is a hard requirement (`00`, ADR-10).
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URI ?? '' },
  }),

  /**
   * Constrained rich text (`07` §4.4) — an accessibility control and a security control
   * simultaneously. Phase 3 narrows this to the fixed element allowlist and adds the paste
   * normalizer, which runs ON PASTE so the database never holds the garbage (`07` §4.2).
   */
  editor: lexicalEditor(),

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
