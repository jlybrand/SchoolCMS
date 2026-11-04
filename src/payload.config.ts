import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { resendAdapter } from '@payloadcms/email-resend'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { buildConfig } from 'payload'

import { isDistrictAdmin } from './access/predicates'
import type { AuthUser } from './access/types'
import { AuditEvents } from './collections/AuditEvents'
import { Navigation } from './collections/Navigation'
import { Pages } from './collections/Pages'
import { PostBoards } from './collections/PostBoards'
import { PostFolders } from './collections/PostFolders'
import { Posts } from './collections/Posts'
import { crossTenantRelationships } from './lib/cross-tenant-relationships'
import { PostTags } from './collections/PostTags'
import { Settings } from './collections/Settings'
import { Tenants } from './collections/Tenants'
import { Theme } from './collections/Theme'
import { Users } from './collections/Users'
import { districtDigestTask } from './jobs/district-digest'
import { postScheduleTask } from './collections/endpoints/post-schedule'
import { constrainedEditor } from './lib/editor'
import { validationResponse } from './lib/validation-errors'

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
    /**
     * The school plane (`04` §2.2): a task-shaped home screen and three task views. The home
     * screen renders Payload's own dashboard for anyone who is not a school manager; the
     * views send anyone else back to it. See src/admin/SchoolPlane/.
     */
    components: {
      views: {
        dashboard: { Component: '/admin/SchoolPlane/SchoolHome#SchoolHome' },
        updatePage: {
          Component: '/admin/SchoolPlane/UpdatePageView#UpdatePageView',
          path: '/update-page',
        },
        newPage: {
          Component: '/admin/SchoolPlane/NewPageView#NewPageView',
          path: '/new-page',
        },
        newPost: {
          Component: '/admin/SchoolPlane/NewPostView#NewPostView',
          path: '/new-post',
        },
        /** The district's approval queue (`04` §4.2). See src/admin/Approvals/. */
        approvals: {
          Component: '/admin/Approvals/ApprovalsView#ApprovalsView',
          path: '/approvals',
        },
      },
      /**
       * The district dashboard (`04` §3.1; Jason, 2026-11-04): approvals, freshness and activity,
       * then the auto-approval panel, then Payload's cards under "Everything else".
       */
      beforeDashboard: [
        '/admin/Dashboard/DistrictDashboard#DistrictDashboard',
        '/admin/Grants/GrantsPanel#GrantsPanel',
        '/admin/Dashboard/DistrictDashboard#EverythingElseHeading',
      ],
      afterNavLinks: ['/admin/Approvals/ApprovalsNavLink#ApprovalsNavLink'],
      /** A school manager's school, named where a tenant picker would be (Jason, 2026-11-04). */
      beforeNavLinks: ['/admin/SchoolPlane/SchoolNameNav#SchoolNameNav'],
      /** Repairs Payload's own markup where it fails axe — a stopgap; see the component. */
      providers: ['/admin/A11yPatch/A11yPatch#A11yPatch'],
    },
  },

  collections: [
    Tenants,
    Users,
    Pages,
    Posts,
    PostFolders,
    PostBoards,
    PostTags,
    Navigation,
    Theme,
    Settings,
    AuditEvents,
  ],

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
      /** Declared in src/collections/Users.ts instead, with the plugin's own builder — see there. */
      tenantsArrayField: { includeDefaultField: false },
      collections: {
        /**
         * Registering here is what injects the `tenant` relationship field — which is why
         * src/collections/Pages.ts does not declare one. The remaining tenant-owned
         * collections join as they land: events, people, documents, media, alerts, redirects.
         */
        pages: {},
        posts: {},
        /** A site's announcement folders and boards (Jason, 2026-10-28). Tags are district-wide. */
        'post-folders': {},
        'post-boards': {},
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
    /**
     * LAST, after the tenant plugin: gives a relationship marked `custom.crossTenant` — only the
     * news feed's boards — back its own filter. See src/lib/cross-tenant-relationships.ts.
     */
    crossTenantRelationships,
  ],

  secret: process.env.PAYLOAD_SECRET ?? '',

  /**
   * Transactional email through Resend (`02` §2, `09` §3): approval outcomes to the submitter
   * (`src/collections/hooks/notify-review-outcome.ts`) and Payload's own forgot-password mail,
   * which interim local auth makes load-bearing (CLAUDE.md, "Authentication").
   *
   * Payload's adapter, not a hand-written client (CLAUDE.md: nothing bespoke where Payload
   * provides it). Only when a key is set: without one — CI, a fresh checkout — Payload logs each
   * message instead of sending it, so nothing can email a real person by accident.
   *
   * Until a sending domain is verified in Resend, the from address must be Resend's own
   * `onboarding@resend.dev`, which delivers ONLY to the Resend account owner's address.
   */
  ...(process.env.RESEND_API_KEY
    ? {
        email: resendAdapter({
          apiKey: process.env.RESEND_API_KEY,
          defaultFromAddress: process.env.RESEND_FROM_ADDRESS || 'onboarding@resend.dev',
          defaultFromName: 'DD2 Websites',
        }),
      }
    : {}),
  /**
   * Payload's jobs queue (`02` §2: "Payload admin + REST/GraphQL + jobs") — the district's
   * daily digest and overdue alert (`src/jobs/district-digest.ts`).
   *
   * `autoRun` every five minutes queues each task's next scheduled run and runs what is due.
   * It only starts in a process that calls `getPayload({ cron: true })`; `src/instrumentation.ts`
   * does that at server start, so a restart overnight cannot silently skip a morning.
   *
   * ACCESS IS DISTRICT-ONLY. Payload's defaults are wide open: the run endpoint falls back to
   * `() => true` (anyone, signed in or not) and the `payload-jobs` collection to "any signed-in
   * user". The runner itself bypasses both, so closing them costs the scheduler nothing.
   * Proven in tests/integration/tenant-isolation.test.ts.
   */
  jobs: {
    /** The digest, and the announcements' Start / Expires / Featured-until sweep. */
    tasks: [districtDigestTask, postScheduleTask],
    autoRun: [{ cron: '*/5 * * * *', queue: 'default' }],
    access: {
      run: ({ req }) => isDistrictAdmin(req.user as AuthUser | null),
      queue: ({ req }) => isDistrictAdmin(req.user as AuthUser | null),
      cancel: ({ req }) => isDistrictAdmin(req.user as AuthUser | null),
    },
    jobsCollectionOverrides: ({ defaultJobsCollection }) => ({
      ...defaultJobsCollection,
      access: {
        read: ({ req }) => isDistrictAdmin(req.user as AuthUser | null),
        create: () => false,
        update: () => false,
        delete: () => false,
      },
    }),
  },
  hooks: {
    /**
     * Puts each field's validation message back into a refused write's response, which the
     * production bundle otherwise drops — see `src/lib/validation-errors.ts`.
     */
    afterError: [
      ({ error }) => {
        const response = validationResponse(error)
        return response ? { response } : undefined
      },
    ],
  },
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },

  // Generated migrations are reviewed and applied as a guarded, reversible step;
  // expand/contract only, tested up and down in CI (`09` §2).
  ...(process.env.NODE_ENV === 'production'
    ? { migrationDir: path.resolve(dirname, '../migrations') }
    : {}),
})
