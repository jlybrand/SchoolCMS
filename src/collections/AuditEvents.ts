import type { CollectionConfig } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import { districtOnly } from '@/access/tenant-scoped'
import type { AuthUser } from '@/access/types'
import { AUDIT_COLLECTION } from '@/collections/hooks/audit'

/**
 * The audit trail (`04` §8, `03` §7, `09` §6): one row per approval-path action and per change
 * to who may do what. Which writes produce a row is `src/lib/audit.ts`; the hooks that write it
 * are `src/collections/hooks/audit.ts`.
 *
 * APPEND-ONLY. Nobody creates, edits or deletes a row through any API — not a district admin
 * either: a record its subject can edit is not a record. Only the hooks write, with access
 * overridden, inside the change's own transaction.
 *
 * District-only to read. It is the district's accountability record; the school plane shows a
 * school its own outcomes through its own views, not this list.
 *
 * NOT a multi-tenant plugin collection: its `tenant` is the school the action concerned, set
 * by the hook, and the plugin's "selected school" filter would hide district-level rows (user
 * and grant changes) whenever a school is selected.
 */
export const AuditEvents: CollectionConfig = {
  slug: AUDIT_COLLECTION,
  labels: { singular: 'Activity entry', plural: 'Activity log' },
  // Stable API names, independent of the admin wording above.
  graphQL: { singularName: 'AuditEvent', pluralName: 'AuditEvents' },
  admin: {
    group: 'Administration',
    useAsTitle: 'documentTitle',
    defaultColumns: ['createdAt', 'action', 'documentTitle', 'tenant', 'actorLabel'],
    description:
      'Every send, approval, request for changes, publish, restore and delete, and every change to a user or an auto-approval grant. Read-only.',
    hidden: ({ user }) => !isDistrictAdmin(user as AuthUser | null),
  },
  access: {
    read: districtOnly,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  timestamps: true,
  fields: [
    { name: 'action', type: 'text', required: true, index: true, admin: { readOnly: true } },
    {
      name: 'contentType',
      label: 'Content type',
      type: 'text',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'documentId',
      label: 'Document id',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    { name: 'documentTitle', label: 'Document', type: 'text', admin: { readOnly: true } },
    {
      name: 'tenant',
      label: 'School',
      type: 'relationship',
      relationTo: 'tenants',
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'actor',
      label: 'By',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true },
    },
    {
      name: 'actorLabel',
      label: 'By (as recorded)',
      type: 'text',
      required: true,
      admin: {
        readOnly: true,
        description: 'The email address at the time, kept if the user is later deleted.',
      },
    },
    { name: 'summary', type: 'textarea', admin: { readOnly: true } },
    {
      name: 'autoApproved',
      label: 'Auto-approved',
      type: 'checkbox',
      defaultValue: false,
      admin: { readOnly: true },
    },
  ],
}
