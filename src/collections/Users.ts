import { ValidationError, type CollectionConfig } from 'payload'

import { validatePassword } from '@/auth/password-policy'
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
  },
  hooks: {
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
      name: 'defaultTenant',
      type: 'relationship',
      relationTo: 'tenants',
      access: { update: districtOnlyField },
    },
    {
      /**
       * `04` §4.3 — auto-approval is a statement about a PERSON, not a content type.
       *
       * EMPTY BY DEFAULT and never defaulted by role, tenant, or collection. Recommended
       * launch posture is zero grants issued at all; issue one only where a specific
       * editor's volume is demonstrably causing queue drag, never pre-emptively.
       *
       * The enforcement that makes a grant safe — that a mixed submission queues in full,
       * and that uploads, rich text, new pages, visibility, SEO, navigation and syndication
       * are never auto-approvable regardless of grant — lands with the approval workflow in
       * Phase 4. This field is the attachment point, deliberately inert until then.
       */
      name: 'autoApprove',
      type: 'select',
      hasMany: true,
      defaultValue: [],
      options: [
        { label: 'Events: schedule-only changes', value: 'events:schedule' },
        { label: 'Posts: routine posts', value: 'posts:routine' },
      ],
      access: { update: districtOnlyField },
      admin: {
        description:
          'OFF BY DEFAULT. Granted per named person by a district-admin, deliberately, and revocable at any time. Changes are audited and surfaced on the district dashboard.',
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
