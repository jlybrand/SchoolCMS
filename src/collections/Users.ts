import { ValidationError, type CollectionConfig } from 'payload'

import { validatePassword } from '@/auth/password-policy'
import { resetPasswordEmailHTML, resetPasswordLink } from '@/auth/reset-email'
import { GRANT_SCOPES } from '@/access/auto-approval'
import { auditChange, auditDelete, auditLogin } from '@/collections/hooks/audit'
import {
  denyAllField,
  districtOnly,
  districtOnlyField,
  selfOrDistrictAdmin,
} from '@/access/tenant-scoped'
import { ROLES } from '@/access/types'
import { missingSchool } from '@/access/user-school'

/**
 * `users` — Payload auth collection (`03` §2).
 *
 * ============================================================================
 * INTERIM POSTURE: Payload local authentication.
 * The design specifies Entra ID OIDC (`02` §7, ADR-6). Local auth is a
 * deliberate, temporary deviation to avoid a district IT dependency during
 * development. See "Authentication" in CLAUDE.md for what it costs and the
 * switch trigger. NOT for production use with real staff accounts.
 * ============================================================================
 *
 * What survives the eventual switch, unchanged: roles, tenant assignment, every access
 * function, and the whole isolation suite. Authentication answers *who you are*;
 * authorization answers *what you may touch*, and only the former changes. That separation
 * is why this deviation is affordable.
 *
 * The `tenants` array field is added by @payloadcms/plugin-multi-tenant.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    tokenExpiration: 60 * 60 * 8,
    // Interim-auth controls. Under Entra, MFA and lockout are inherited from the district
    // directory and none of this is ours to get right (`02` §7).
    maxLoginAttempts: 5,
    lockTime: 10 * 60 * 1000,
    // Payload's own link has no origin here — see `src/auth/reset-email.ts`.
    forgotPassword: {
      generateEmailHTML: ({ req, token } = {}) =>
        resetPasswordEmailHTML(
          resetPasswordLink({
            serverUrl: process.env.NEXT_PUBLIC_SERVER_URL,
            adminRoute: req?.payload.config.routes.admin ?? '/admin',
            token: token ?? '',
          }),
        ),
    },
  },
  hooks: {
    beforeOperation: [
      ({ args, operation }) => {
        /**
         * The same password policy on the forgot-password reset. That path hashes the new
         * password before the collection hooks run and hands `beforeValidate` the user without
         * it, so the hook below never sees it — without this, a reset accepted any non-empty
         * password. Checked here, before the token is looked up or anything is written.
         */
        if (operation !== 'resetPassword') return args
        const result = validatePassword((args as { data?: { password?: unknown } }).data?.password)
        if (result !== true)
          throw new ValidationError({ errors: [{ path: 'password', message: result }] })
        return args
      },
    ],
    beforeValidate: [
      ({ data }) => {
        /**
         * Password strength (NIST SP 800-63B — length over composition).
         *
         * Enforced in a hook rather than only on the form so the REST and Local API paths
         * cannot bypass it, which is the same reasoning as required alt text (`07` §4.3).
         * Deleted along with local auth when Entra lands.
         */
        const password = (data as { password?: unknown } | undefined)?.password
        if (password === undefined || password === null || password === '') return data

        const result = validatePassword(password)
        if (result !== true)
          throw new ValidationError({ errors: [{ path: 'password', message: result }] })

        return data
      },
      /**
       * A school manager must have a school (`src/access/user-school.ts`). A hook, not a
       * `validate` on the plugin-injected `tenants` field, so the REST and Local API paths are
       * held to it too, and so it can see `roles` beside `tenants`.
       */
      ({ data, originalDoc }) => {
        const message = missingSchool(data, originalDoc)
        if (message) throw new ValidationError({ errors: [{ path: 'tenants', message }] })
        return data
      },
    ],
    /**
     * User and grant changes (`09` §6, `04` §4.3), and every sign-in. Only permission-bearing
     * fields produce a change entry, so a password change records nothing (`src/lib/audit.ts`).
     */
    afterChange: [auditChange('users')],
    afterDelete: [auditDelete('users')],
    afterLogin: [auditLogin],
  },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'roles', 'lastLoginAt'],
    group: 'Administration',
  },
  access: {
    read: selfOrDistrictAdmin,
    create: districtOnly,
    delete: districtOnly,
    /**
     * Update is district-only. A school-manager cannot edit their own roles, tenants, or
     * auto-approve grants — self-service on this collection is privilege escalation, since
     * every field on it is a permission.
     */
    update: districtOnly,
    unlock: districtOnly,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
    },
    {
      name: 'entraObjectId',
      type: 'text',
      unique: true,
      index: true,
      access: {
        // Set by the auth strategy at login; never hand-edited, or the durable identity
        // link breaks and a user silently becomes a different person.
        update: denyAllField,
      },
      admin: {
        readOnly: true,
        description:
          'Durable Entra identity (`03` §2). UNUSED under interim local auth — kept as the seam so existing accounts can be linked to Entra objects at switchover rather than recreated.',
      },
    },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      required: true,
      defaultValue: [],
      options: ROLES.map((value) => ({ label: value, value })),
      access: { update: districtOnlyField },
      admin: {
        description:
          'Refreshed from Entra group membership at login (`02` §7). system-sync is a non-human actor for the PowerSchool sync — never assign it to a person (`11` §8).',
      },
    },
    {
      /**
       * `04` §4.3 — auto-approval is a statement about a PERSON, not a content type.
       *
       * EMPTY BY DEFAULT and never defaulted by role, tenant, or collection. Recommended
       * launch posture is zero grants issued at all; issue one only where a specific
       * editor's volume is demonstrably causing queue drag, never pre-emptively.
       *
       * What a grant permits — and that a mixed submission queues in full, and that uploads,
       * rich text, new pages, visibility, SEO, navigation and syndication never auto-approve —
       * is decided in `src/access/auto-approval.ts`. Both scopes are for posts and events
       * (Phase 5); until those land, holding one changes nothing.
       *
       * Rendered as checkboxes: Payload's select input fails the axe gate. The stored shape is
       * still the select's, an array of scopes.
       */
      name: 'autoApprove',
      type: 'select',
      hasMany: true,
      defaultValue: [],
      options: GRANT_SCOPES.map(({ label, value }) => ({ label, value })),
      access: { update: districtOnlyField },
      admin: {
        components: { Field: '/admin/Grants/GrantScopesField#GrantScopesField' },
        description:
          'OFF BY DEFAULT. Granted per named person by a district-admin, deliberately, and revocable at any time. Changes are audited and surfaced on the district dashboard.',
      },
    },
    {
      /**
       * Which district admins get the district's mail — the daily digest, the overdue alert,
       * and alerts added later (Jason, 2026-10-23). About mail only: every district admin keeps
       * the same rights. Read by `alertRecipients` (`src/lib/district-digest.ts`), which mails
       * everyone if nobody is opted in.
       *
       * ON BY DEFAULT, so turning it off is the deliberate act. Shown only on a district admin;
       * a school manager never receives district mail.
       */
      name: 'receivesAlerts',
      type: 'checkbox',
      label: 'Email this person the approval digest and district alerts',
      defaultValue: true,
      access: { update: districtOnlyField },
      admin: {
        condition: (data) => Array.isArray(data?.roles) && data.roles.includes('district-admin'),
        description:
          'Every district admin keeps the same rights either way. If nobody has this on, every district admin is emailed, so the approval queue is never silent.',
      },
    },
    {
      name: 'isBreakGlass',
      type: 'checkbox',
      defaultValue: false,
      access: { update: denyAllField },
      admin: {
        readOnly: true,
        description:
          'The single local admin for initial setup and Entra misconfiguration recovery (`02` §7). MFA-protected, audited, excluded from normal login paths. Rotate the credential after any use.',
      },
    },
    {
      name: 'lastLoginAt',
      type: 'date',
      access: { update: denyAllField },
      admin: { readOnly: true },
    },
  ],
}
