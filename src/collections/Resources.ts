import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ValidationError,
  type CollectionBeforeChangeHook,
  type CollectionBeforeValidateHook,
  type CollectionConfig,
} from 'payload'

import { tenantIdOf } from '@/access/predicates'
import {
  resourcesCreateAccess,
  resourcesReadAccess,
  resourcesWriteAccess,
} from '@/access/resources'
import { auditChange, auditDelete } from '@/collections/hooks/audit'
import { ACCEPTED_MIME_TYPES, kindOf, parseTags, resourceProblems } from '@/lib/resources'

/**
 * A site's file library (Jason, 2026-11-13; Finalsite's Resources): ONE library of images and
 * documents, in folders, each file with a title, a description and tags.
 *
 * - IMAGES need alt text unless marked decorative — refused by the field's validation AND by
 *   `beforeValidate`, so no route skips it (CLAUDE.md rule 7). Payload makes the derivatives.
 * - DOCUMENTS need their accessibility attestation (`07` §5); `not-attested` ones are the
 *   district's work queue. The platform records it; it does not remediate.
 * - No video (YouTube only) and no SVG — Payload refuses the type before anything is stored.
 * - Schools upload to their own school with NO APPROVAL (Jason); the log records every change.
 *
 * Stored on local disk in development (`media/`), on Cloudflare R2 when it is configured
 * (`src/payload.config.ts`).
 */

const dirname = path.dirname(fileURLToPath(import.meta.url))

type Data = Record<string, unknown>

const merged = (data: Data | undefined, originalDoc: Data | undefined): Data => ({
  ...(originalDoc ?? {}),
  ...(data ?? {}),
})

/** Rule 7, and the attestation — on every route, before anything is stored. */
const checkFile: CollectionBeforeValidateHook = ({ data, originalDoc, req }) => {
  const all = merged(data as Data, originalDoc as Data)
  const mimeType = (all.mimeType as string | undefined) ?? req.file?.mimetype
  const problems = resourceProblems({ ...all, mimeType })
  if (problems.length > 0) throw new ValidationError({ errors: problems })
  return data
}

/** Kind, tags, the folder's school, and who attested when. */
const settle: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  const all = merged(data as Data, originalDoc as Data)
  const next: Data = { ...data, kind: kindOf(all.mimeType as string) }
  if (data?.tagsText !== undefined) next.tags = parseTags(data.tagsText)

  const folder = all.folder
  if (folder !== null && folder !== undefined && folder !== '') {
    const found = (await req.payload.findByID({
      collection: 'resource-folders',
      id: (typeof folder === 'object' ? (folder as { id: string }).id : folder) as string,
      depth: 0,
      overrideAccess: true,
      disableErrors: true,
      req,
    })) as Data | null
    if (!found || tenantIdOf(found.tenant as never) !== tenantIdOf(all.tenant as never)) {
      throw new ValidationError({
        errors: [{ path: 'folder', message: 'Choose a folder from this school’s library.' }],
      })
    }
  }

  if (
    data?.remediationStatus !== undefined &&
    data.remediationStatus !== originalDoc?.remediationStatus
  ) {
    const attested = data.remediationStatus === 'attested'
    next.attestedBy = attested ? (req.user?.id ?? null) : null
    next.attestedAt = attested ? new Date().toISOString() : null
  }
  return next
}

const isImage = (data: Data | undefined) => {
  const kind = kindOf(data?.mimeType as string | undefined)
  return kind === null || kind === 'image'
}
const isDocument = (data: Data | undefined) => {
  const kind = kindOf(data?.mimeType as string | undefined)
  return kind === null || kind === 'document'
}

export const Resources: CollectionConfig = {
  slug: 'resources',
  labels: { singular: 'File', plural: 'Files' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'kind', 'folder', 'updatedAt'],
    group: 'Site',
    description: 'A site’s images and documents. Video goes on YouTube.',
    /** "Upload a file", not Payload's "Create New" (Jason, 2026-11-13). */
    components: {
      beforeListTable: ['/admin/Resources/UploadFileButton#UploadFileButton'],
      edit: { beforeDocumentControls: ['/admin/Resources/UploadingHeading#UploadingHeading'] },
    },
  },
  access: {
    read: resourcesReadAccess,
    create: resourcesCreateAccess,
    update: resourcesWriteAccess,
    delete: resourcesWriteAccess,
  },
  upload: {
    staticDir: path.resolve(dirname, '../../media'),
    mimeTypes: [...ACCEPTED_MIME_TYPES],
    focalPoint: true,
    adminThumbnail: 'thumbnail',
    imageSizes: [
      { name: 'thumbnail', width: 400, formatOptions: { format: 'webp' } },
      { name: 'card', width: 800, formatOptions: { format: 'webp' } },
      { name: 'hero', width: 1600, formatOptions: { format: 'webp' } },
    ],
  },
  hooks: {
    beforeValidate: [checkFile],
    beforeChange: [settle],
    afterChange: [auditChange('resources')],
    afterDelete: [auditDelete('resources')],
  },
  fields: [
    { name: 'title', type: 'text', label: 'Title', required: true },
    {
      name: 'alt',
      type: 'text',
      label: 'Describe the image',
      admin: {
        description: 'What someone who can’t see it needs to know. Not needed if it’s decorative.',
        condition: (data) => isImage(data),
      },
      // Rule 7, at the field too — the hook above holds it on every route.
      validate: (value: unknown, { siblingData }: { siblingData: Data }) => {
        const problem = resourceProblems({ ...siblingData, alt: value }).find(
          (p) => p.path === 'alt',
        )
        return problem ? problem.message : true
      },
    },
    {
      name: 'isDecorative',
      type: 'checkbox',
      label: 'This image is decorative — it adds nothing a description would',
      admin: { condition: (data) => isImage(data) },
    },
    {
      name: 'remediationStatus',
      // A radio, not a select: Payload's select input fails axe (`docs/phases/04` §17).
      type: 'radio',
      label: 'Has this document been checked for accessibility?',
      options: [
        { label: 'Yes — checked and fixed', value: 'attested' },
        { label: 'No — not checked yet', value: 'not-attested' },
        { label: 'Not needed — it’s a form to print, or similar', value: 'not-applicable' },
      ],
      admin: { condition: (data) => isDocument(data) },
      validate: (value: unknown, { siblingData }: { siblingData: Data }) => {
        const problem = resourceProblems({ ...siblingData, remediationStatus: value }).find(
          (p) => p.path === 'remediationStatus',
        )
        return problem ? problem.message : true
      },
    },
    { name: 'description', type: 'textarea', label: 'Description' },
    {
      name: 'tagsText',
      type: 'text',
      label: 'Tags',
      admin: { description: 'Separate tags with commas, for example “forms, enrollment”.' },
    },
    {
      /** `tagsText` split and tidied (`parseTags`) — what search and filters read. */
      name: 'tags',
      type: 'json',
      admin: { hidden: true },
    },
    {
      name: 'folder',
      type: 'relationship',
      relationTo: 'resource-folders',
      label: 'Folder',
      admin: { position: 'sidebar' },
    },
    {
      /** `image` or `document`, from the file's type — worked out on every save. */
      name: 'kind',
      type: 'text',
      index: true,
      admin: { hidden: true },
    },
    {
      name: 'attestedBy',
      type: 'relationship',
      relationTo: 'users',
      label: 'Checked by',
      admin: {
        readOnly: true,
        position: 'sidebar',
        condition: (data) => data?.remediationStatus === 'attested',
      },
    },
    {
      name: 'attestedAt',
      type: 'date',
      label: 'Checked on',
      admin: {
        readOnly: true,
        position: 'sidebar',
        condition: (data) => data?.remediationStatus === 'attested',
      },
    },
  ],
}
