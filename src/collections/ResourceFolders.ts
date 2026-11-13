import { ValidationError, type CollectionConfig } from 'payload'

import { tenantIdOf } from '@/access/predicates'
import {
  resourcesCreateAccess,
  resourcesReadAccess,
  resourcesWriteAccess,
} from '@/access/resources'
import { folderLabel, folderMovesUnder } from '@/lib/resources'

/**
 * Folders in a site's file library (Jason, 2026-11-13; Finalsite's Resources): each school's own,
 * nested as deep as it likes. A folder sits in its school's library or inside another folder of
 * the SAME school, never inside itself or anything inside it. `label` ("Forms › Enrollment") is
 * worked out on every save. Access as the files' (`src/access/resources.ts`); tenant-scoped by
 * the multi-tenant plugin.
 */

type Row = Record<string, unknown>
const idOf = (ref: unknown): string | null =>
  ref === null || ref === undefined || ref === ''
    ? null
    : typeof ref === 'object'
      ? idOf((ref as { id?: unknown }).id)
      : String(ref)

export const ResourceFolders: CollectionConfig = {
  slug: 'resource-folders',
  labels: { singular: 'Folder', plural: 'Folders' },
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label'],
    group: 'Site',
    description: 'Folders for a site’s files. Put folders inside folders to keep things tidy.',
  },
  defaultSort: 'label',
  access: {
    read: resourcesReadAccess,
    create: resourcesCreateAccess,
    update: resourcesWriteAccess,
    delete: resourcesWriteAccess,
  },
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        const name = String(data?.name ?? originalDoc?.name ?? '').trim()
        const tenant = tenantIdOf((data?.tenant ?? originalDoc?.tenant) as never)
        const parentId = idOf(data?.parent !== undefined ? data.parent : originalDoc?.parent)
        const id = idOf(originalDoc?.id)

        const find = async (folder: string) =>
          (await req.payload.findByID({
            collection: 'resource-folders',
            id: folder,
            depth: 0,
            overrideAccess: true,
            disableErrors: true,
            req,
          })) as Row | null

        if (parentId === null) return { ...data, label: folderLabel([name]) }

        const parent = await find(parentId)
        if (!parent || tenantIdOf(parent.tenant as never) !== tenant) {
          throw new ValidationError({
            errors: [{ path: 'parent', message: 'Choose a folder from this school’s library.' }],
          })
        }
        // Walk the stored tree once, so the cycle check and the label share it.
        const parents = new Map<string, string | null>()
        const names: string[] = []
        let at: Row | null = parent
        for (let steps = 0; at && steps < 100; steps += 1) {
          names.unshift(String(at.name ?? ''))
          const up = idOf(at.parent)
          parents.set(String(at.id), up)
          at = up === null ? null : await find(up)
        }
        if (id !== null && !folderMovesUnder(id, parentId, (f) => parents.get(f) ?? null)) {
          throw new ValidationError({
            errors: [{ path: 'parent', message: 'A folder can’t go inside itself.' }],
          })
        }
        return { ...data, label: folderLabel([...names, name]) }
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text', label: 'Name', required: true },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'resource-folders',
      label: 'Inside',
      admin: { description: 'Leave empty for a folder at the top of the library.' },
    },
    {
      /** "Forms › Enrollment" — worked out on every save. */
      name: 'label',
      type: 'text',
      index: true,
      admin: { hidden: true },
    },
  ],
}
