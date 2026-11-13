import { ValidationError, type CollectionConfig, type Field } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import { districtOnly } from '@/access/tenant-scoped'
import type { AuthUser } from '@/access/types'
import { auditChange, auditDelete } from '@/collections/hooks/audit'
import { revalidateAllSites } from '@/collections/hooks/revalidate-on-publish'
import {
  ALERT_TEMPLATES,
  ALERT_VARIABLES,
  alertText,
  missingVariables,
  templateSeverity,
} from '@/lib/alerts'
import { SCHEDULE_STEP_MINUTES } from '@/lib/schedule-step'

/**
 * `alerts` — the banners across the top of the public sites (Jason, 2026-11-12; `03` §alerts,
 * `04` §3.4). The rules are `src/lib/alerts.ts`; the public read `src/content/alerts.ts`.
 *
 * THE DISTRICT'S ONLY, every route: school managers cannot post, read or change them (`03` §5).
 * Not owned by one site — an alert reaches the sites and pages it is placed on — so it is not in
 * the multi-tenant plugin.
 *
 * A TEMPLATE IS THE DEFAULT: pick one, fill its blanks, and the message is written from its
 * wording (English only until Phase 7's verified translations). Free text takes an extra
 * confirmation (`04` §3.4: 5am is the wrong time to compose prose). The message and severity are
 * worked out on every save and stored (`text`, `severity`), so the public read does no templating.
 *
 * Saving or deleting one refreshes every site at once; the schedule job refreshes them again when
 * an alert's start or end passes. Rendered with the page, not fetched after it, so the banner
 * never pushes the page down after it has drawn.
 */

type Data = Record<string, unknown>

const kindIs = (kind: 'template' | 'custom') => (data: Data | undefined) =>
  (data?.kind ?? 'template') === kind

const usesVariable = (name: string) => (data: Data | undefined) =>
  kindIs('template')(data) &&
  ALERT_TEMPLATES.some((t) => t.key === data?.template && t.variables.some((v) => v.name === name))

const SEVERITY_WORDS = { info: 'notice', warning: 'warning', emergency: 'emergency' } as const

const levelBoxes: Field[] = [
  { name: 'elementary', type: 'checkbox', label: 'Elementary' },
  { name: 'middle', type: 'checkbox', label: 'Middle' },
  { name: 'high', type: 'checkbox', label: 'High' },
]

export const Alerts: CollectionConfig = {
  slug: 'alerts',
  labels: { singular: 'Alert', plural: 'Alerts' },
  admin: {
    group: 'Site',
    useAsTitle: 'text',
    defaultColumns: ['text', 'severity', 'startAt', 'endAt'],
    description: 'Banners across the top of the websites — closures, delays, emergencies.',
    hidden: ({ user }) => !isDistrictAdmin(user as AuthUser | null),
  },
  access: {
    read: districtOnly,
    create: districtOnly,
    update: districtOnly,
    delete: districtOnly,
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc }) => {
        const all = { ...(originalDoc ?? {}), ...(data ?? {}) } as Data
        if ((all.kind ?? 'template') === 'template') {
          const key = String(all.template ?? '')
          const severity = templateSeverity(key)
          if (severity === null) {
            throw new ValidationError({
              errors: [{ path: 'template', message: 'Choose a template.' }],
            })
          }
          const missing = missingVariables(key, all)
          if (missing.length > 0) {
            throw new ValidationError({
              errors: missing.map((name) => ({
                path: name,
                message: `Fill in “${ALERT_VARIABLES.find((v) => v.name === name)?.label ?? name}”.`,
              })),
            })
          }
          return { ...data, severity, text: alertText(key, all) }
        }

        const message = typeof all.message === 'string' ? all.message.trim() : ''
        const errors: { path: string; message: string }[] = []
        if (message === '') errors.push({ path: 'message', message: 'Write the message.' })
        if (!['info', 'warning', 'emergency'].includes(String(all.severity))) {
          errors.push({ path: 'severity', message: 'Choose how urgent it is.' })
        }
        if (all.confirmCustom !== true) {
          errors.push({
            path: 'confirmCustom',
            message: 'Confirm you are writing your own words, or use a template.',
          })
        }
        if (errors.length > 0) throw new ValidationError({ errors })
        return { ...data, text: message }
      },
    ],
    afterChange: [
      auditChange('alerts'),
      async ({ doc, req }) => {
        await revalidateAllSites(req, `alert ${String(doc.id)}`)
        return doc
      },
    ],
    afterDelete: [
      auditDelete('alerts'),
      async ({ doc, req }) => {
        await revalidateAllSites(req, `alert ${String(doc.id)} removed`)
        return doc
      },
    ],
  },
  fields: [
    {
      name: 'kind',
      type: 'radio',
      label: 'Message',
      defaultValue: 'template',
      options: [
        { label: 'Use a template', value: 'template' },
        { label: 'Write my own message', value: 'custom' },
      ],
    },
    {
      name: 'template',
      type: 'radio',
      label: 'Template',
      options: ALERT_TEMPLATES.map((t) => ({
        label: `${t.label} (${SEVERITY_WORDS[t.severity]})`,
        value: t.key,
      })),
      admin: { condition: kindIs('template') },
    },
    ...ALERT_VARIABLES.map((v): Field => ({
      name: v.name,
      type: 'text',
      label: v.label,
      admin: { description: v.hint, condition: usesVariable(v.name) },
    })),
    {
      name: 'message',
      type: 'textarea',
      label: 'Your message',
      admin: { condition: kindIs('custom') },
    },
    {
      name: 'severity',
      type: 'radio',
      label: 'How urgent',
      options: [
        { label: 'Notice — visitors can close it', value: 'info' },
        { label: 'Warning — visitors can close it', value: 'warning' },
        { label: 'Emergency — stays on screen', value: 'emergency' },
      ],
      admin: { condition: kindIs('custom') },
    },
    {
      name: 'confirmCustom',
      type: 'checkbox',
      label:
        'I am writing my own words. Templates are quicker and, later, already translated into other languages.',
      admin: { condition: kindIs('custom') },
    },
    {
      name: 'linkUrl',
      type: 'text',
      label: 'Link for more information',
      admin: { description: 'A full web address, or a page on the site such as /calendar.' },
      validate: (value: unknown) =>
        value === undefined ||
        value === null ||
        value === '' ||
        /^(https?:\/\/|\/)/.test(String(value)) ||
        'Start with https:// or with / for a page on the site.',
    },
    {
      name: 'linkLabel',
      type: 'text',
      label: 'Link text',
      admin: {
        description: 'What the link says, for example “Read more”.',
        condition: (data) => typeof data?.linkUrl === 'string' && data.linkUrl !== '',
      },
    },
    {
      name: 'siteScope',
      type: 'radio',
      label: 'Sites',
      defaultValue: 'all',
      options: [
        { label: 'All sites', value: 'all' },
        { label: 'By level', value: 'level' },
        { label: 'Chosen sites', value: 'chosen' },
      ],
    },
    {
      name: 'levels',
      type: 'group',
      label: 'Levels',
      admin: {
        description: 'Every school that serves a ticked level. The district site is not a level.',
        condition: (data) => data?.siteScope === 'level',
      },
      fields: levelBoxes,
    },
    {
      name: 'sites',
      type: 'relationship',
      relationTo: 'tenants',
      hasMany: true,
      label: 'Chosen sites',
      admin: { condition: (data) => data?.siteScope === 'chosen' },
    },
    {
      name: 'pageScope',
      type: 'radio',
      label: 'Pages',
      defaultValue: 'every',
      options: [
        { label: 'Every page', value: 'every' },
        { label: 'Home pages only', value: 'home' },
        { label: 'Chosen pages', value: 'chosen' },
      ],
    },
    {
      name: 'pages',
      type: 'relationship',
      relationTo: 'pages',
      hasMany: true,
      label: 'Chosen pages',
      admin: { condition: (data) => data?.pageScope === 'chosen' },
    },
    {
      name: 'startAt',
      type: 'date',
      label: 'Starts',
      index: true,
      admin: {
        description: 'Leave empty to show it now.',
        // Five-minute steps: the schedule refreshes the sites on the five (`src/lib/schedule-step.ts`).
        date: { pickerAppearance: 'dayAndTime', timeIntervals: SCHEDULE_STEP_MINUTES },
        position: 'sidebar',
      },
    },
    {
      name: 'endAt',
      type: 'date',
      label: 'Ends',
      index: true,
      admin: {
        description: 'Leave empty to show it until you remove it.',
        // Five-minute steps: the schedule refreshes the sites on the five (`src/lib/schedule-step.ts`).
        date: { pickerAppearance: 'dayAndTime', timeIntervals: SCHEDULE_STEP_MINUTES },
        position: 'sidebar',
      },
    },
    {
      /** What visitors read — worked out on every save (`beforeChange`). */
      name: 'text',
      type: 'text',
      label: 'What visitors will read',
      admin: { readOnly: true, position: 'sidebar' },
    },
  ],
}
