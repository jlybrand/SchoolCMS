import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { Users } from './collections/Users'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Payload 3, pinned (ADR-4). The plugin surface is deliberately minimal — every plugin is
 * a swap cost (`02` §2). Phase 1 adds `@payloadcms/plugin-multi-tenant`; Phase 3 adds
 * `@payloadcms/plugin-seo`; Phase 6 adds cloud storage for R2. Nothing else is adopted
 * without weighing its contribution to the switching cost (`02` §11).
 */
export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
  },

  collections: [Users],

  // Postgres, never Mongo — portability is a hard requirement (`00`, ADR-10).
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URI ?? '' },
  }),

  /**
   * Constrained rich text (`07` §4.4). The element allowlist is an accessibility control
   * and a security control simultaneously: editors cannot express a formatting idea the
   * design system has not already made accessible.
   *
   * Phase 3 adds the paste normalizer on top of this — normalization happens ON PASTE, not
   * on render, so the database never holds the garbage (`07` §4.2).
   */
  editor: lexicalEditor(),

  secret: process.env.PAYLOAD_SECRET ?? '',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },

  // Generated migrations are reviewed and applied as a guarded, reversible step;
  // expand/contract only, tested up and down in CI (`09` §2).
  ...(process.env.NODE_ENV === 'production'
    ? { migrationDir: path.resolve(dirname, '../migrations') }
    : {}),
})
