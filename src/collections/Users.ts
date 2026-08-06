import type { CollectionConfig } from 'payload'

import {
  denyAllField,
  districtOnly,
  districtOnlyField,
  selfOrDistrictAdmin,
} from '@/access/tenant-scoped'
import { ROLES } from '@/access/types'

/**
 * `users` — Payload auth collection, backed by Entra ID (`03` §2, `02` §7).
 *
 * No password is stored for Entra-authenticated staff. Roles and tenant assignments refresh
 * from Entra group membership at login, and **deprovisioning is automatic** — when IT
 * disables a district account, platform access ends with it. That is the material advantage
 * over local accounts, where removal depends on someone remembering.
 *
 * The `tenants` array field is added by @payloadcms/plugin-multi-tenant.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    // Local auth remains enabled ONLY for the single break-glass admin (`02` §7).
    // Every other account authenticates through Entra; see src/auth/entra.ts.
    tokenExpiration: 60 * 60 * 8,
    maxLoginAttempts: 5,
    lockTime: 10 * 60 * 1000,
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
        description: 'Durable Entra identity (`03` §2). Survives email and name changes.',
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
