import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { resendAdapter } from '@payloadcms/email-resend'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { s3Storage } from '@payloadcms/storage-s3'
import { buildConfig } from 'payload'
import sharp from 'sharp'

import { isDistrictAdmin } from './access/predicates'
import type { AuthUser } from './access/types'
import { Alerts } from './collections/Alerts'
import { AuditEvents } from './collections/AuditEvents'
import { Navigation } from './collections/Navigation'
import { SCHEDULE_CRON } from './lib/schedule-step'
import { Pages } from './collections/Pages'
import { People } from './collections/People'
import { MAX_UPLOAD_BYTES } from './admin/SchoolPlane/upload-file'
import { ResourceFolders } from './collections/ResourceFolders'
import { Resources } from './collections/Resources'
import { siteSearch } from './collections/search-index'
import { PostBoards } from './collections/PostBoards'
import { PostFolders } from './collections/PostFolders'
import { Posts } from './collections/Posts'
import { crossTenantRelationships } from './lib/cross-tenant-relationships'
import { PostTags } from './collections/PostTags'
import { Calendars } from './collections/Calendars'
import { Events } from './collections/Events'
import { StaffGroups } from './collections/StaffGroups'
import { Settings } from './collections/Settings'
import { Tenants } from './collections/Tenants'
import { Theme } from './collections/Theme'
import { Users } from './collections/Users'
import { districtDigestTask } from './jobs/district-digest'
import { calendarFeedsTask } from './jobs/calendar-feeds'
import { scheduleEndpoint, scheduleTask } from './collections/endpoints/schedule'
import { staffSyncEndpoint, staffSyncTask } from './collections/endpoints/staff-sync'
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
  /** Image sizes and focal-point crops for the file library (`src/collections/Resources.ts`). */
  sharp,
  /** The file library takes nothing over 25 MB (`MAX_UPLOAD_BYTES`, the school's form says so). */
  upload: { limits: { fileSize: MAX_UPLOAD_BYTES } },
  admin: {
    /** Browser tabs read "Approvals - DD2 Websites", not Payload's default "- Payload". */
    meta: { titleSuffix: '- DD2 Websites' },
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
        /** "Add an event" (Jason, 2026-11-11). */
        newEvent: {
          Component: '/admin/SchoolPlane/NewEventView#NewEventView',
          path: '/new-event',
        },
        /** "Upload a file" — a school's upload to its own library (Jason, 2026-11-13). */
        uploadFile: {
          Component: '/admin/SchoolPlane/UploadFileView#UploadFileView',
          path: '/upload-file',
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
      /**
       * The way home, at the very top of the side navigation: an icon link to the dashboard, both
       * planes (Jason, 2026-11-12). `beforeNav`, not `beforeNavLinks`: the multi-tenant plugin
       * appends its "Filter by Tenant" box to `beforeNav`, so only there does this come first.
       */
      beforeNav: ['/admin/Nav/DashboardNavLink#DashboardNavLink'],
      /** A school manager's school, named where a tenant picker would be (Jason, 2026-11-04). */
      beforeNavLinks: ['/admin/SchoolPlane/SchoolNameNav#SchoolNameNav'],
      /** Repairs Payload's own markup where it fails axe — a stopgap; see the component. */
      providers: ['/admin/A11yPatch/A11yPatch#A11yPatch'],
    },
  },

  /** The schedule's sweep, for the job to call inside a request (`src/collections/endpoints/schedule.ts`). */
  endpoints: [scheduleEndpoint, staffSyncEndpoint],

  collections: [
    Tenants,
    Users,
    Pages,
    Posts,
    PostFolders,
    PostBoards,
    PostTags,
    Calendars,
    Events,
    Navigation,
    Theme,
    Settings,
    Alerts,
    People,
    StaffGroups,
    Resources,
    ResourceFolders,
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
     * Files on Cloudflare R2 (`02`, `09` §1) once it is configured; on local disk (`media/`)
     * until then. R2 speaks S3. Uploads still pass the collection's access and hooks either way.
     */
    ...(process.env.R2_BUCKET && process.env.R2_ACCOUNT_ID
      ? [
          s3Storage({
            collections: { resources: true },
            bucket: process.env.R2_BUCKET,
            config: {
              endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
              region: 'auto',
              credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
              },
            },
          }),
        ]
      : []),
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
      /**
       * OFF (2026-11-11). On by default, it deletes every document of a deleted tenant — one
       * mistaken delete would take a school's pages, announcements and events beyond undo. A site
       * is refused deletion while it has content instead (src/collections/hooks/tenant-delete.ts).
       */
      cleanupAfterTenantDelete: false,
      /** Declared in src/collections/Users.ts instead, with the plugin's own builder — see there. */
      tenantsArrayField: { includeDefaultField: false },
      collections: {
        /**
         * Registering here is what injects the `tenant` relationship field — which is why
         * src/collections/Pages.ts does not declare one. The remaining tenant-owned
         * collections join as they land: redirects. (`resources` and `resource-folders` joined
         * 2026-11-13 — one file library, in place of the spec's separate documents and media.) NOT `people` or
         * `staff-groups` (Jason, 2026-11-13): a staff group is a CSI location, not a site, and a
         * page shows whichever group it is set to (`src/access/people.ts`).
         */
        pages: {},
        posts: {},
        /** A site's announcement folders and boards (Jason, 2026-10-28). Tags are district-wide. */
        'post-folders': {},
        'post-boards': {},
        /** A site's calendars and their events (Jason, 2026-10-28). */
        calendars: {},
        events: {},
        /** A site's file library and its folders (Jason, 2026-11-13). */
        resources: {},
        'resource-folders': {},
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
    /** The site search index (Phase 6 D) — see src/collections/search-index.ts. */
    siteSearch,
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
   * `autoRun` every five minutes (`SCHEDULE_CRON` — the steps the schedule pickers offer) queues each task's next scheduled run and runs what is due.
   * It only starts in a process that calls `getPayload({ cron: true })`; `src/instrumentation.ts`
   * does that at server start, so a restart overnight cannot silently skip a morning.
   *
   * ACCESS IS DISTRICT-ONLY. Payload's defaults are wide open: the run endpoint falls back to
   * `() => true` (anyone, signed in or not) and the `payload-jobs` collection to "any signed-in
   * user". The runner itself bypasses both, so closing them costs the scheduler nothing.
   * Proven in tests/integration/tenant-isolation.test.ts.
   */
  jobs: {
    /**
     * The digest; the Start / Expires / Featured-until sweep; feed calendars (hourly); the CSI
     * staff sync (nightly, `src/collections/endpoints/staff-sync.ts`).
     */
    tasks: [districtDigestTask, scheduleTask, calendarFeedsTask, staffSyncTask],
    autoRun: [{ cron: SCHEDULE_CRON, queue: 'default' }],
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
