import { validations, type Config } from 'payload'

/**
 * A page's SECTIONS are checked when it is published or sent for approval, not while it is being
 * written (Jason, 2026-11-19: "when a section is added to a page it immediately shows an error —
 * this should only happen if attempting to publish or send for approval").
 *
 * WHY IT SHOWED AT ONCE. Pages, posts and events autosave with `drafts.validate: true` — which
 * keeps an untitled draft from ever being made (see `src/collections/Pages.ts`). So the first
 * autosave after adding a section checked it, found its required words empty, and showed the
 * error before the editor had typed a thing.
 *
 * WHAT THIS DOES. Payload validates a field in two places: the form's own check as you edit
 * (`event: 'onChange'`) and the server's on a save (`event: 'submit'`). Autosave is a save,
 * tagged `?autosave=true`. Every field INSIDE a blocks field — a section's, a card's, a column's —
 * passes both of those; any other save is checked in full by the field's own rule (or Payload's
 * default for its type, `validations`): Publish, Send for approval (a draft save without the
 * autosave tag, `SendForApprovalButton`), and every API write. Fields outside sections — a page's
 * title, its slug — are untouched, so `validate: true` still refuses an untitled draft.
 *
 * Nothing incomplete can go live: the publish and the send are the checked saves, and an autosave
 * only writes a draft. Runs after the plugins (`plugins`, last), on every collection's blocks.
 */

type Options = { event?: unknown; req?: { query?: Record<string, unknown> } }
type Validate = (value: unknown, options: Options & Record<string, unknown>) => unknown
type AnyField = {
  type?: string
  validate?: Validate
  fields?: AnyField[] | undefined
  blocks?: { fields?: AnyField[] | undefined }[]
  tabs?: { fields?: AnyField[] | undefined }[]
  virtual?: unknown
}

/** As you edit, or an autosave: not yet the moment a section must be complete. */
export const isDeferred = (options: Options): boolean =>
  options.event === 'onChange' || String(options.req?.query?.autosave) === 'true'

const defaults = validations as unknown as Record<string, Validate | undefined>

const deferred = (field: AnyField): AnyField => {
  const own = field.validate
  const fallback = field.type ? defaults[field.type] : undefined
  if (!own && !fallback) return field
  const check: Validate = own ?? ((value, options) => fallback!(value, { ...field, ...options }))
  return {
    ...field,
    validate: (value, options) => (isDeferred(options) ? true : check(value, options)),
  }
}

/** Every field below a blocks field, deferred; `inSection` once inside one. */
const walk = (fields: AnyField[] | undefined, inSection: boolean): AnyField[] | undefined =>
  fields?.map((field) => {
    let next: AnyField = { ...field }
    if (next.fields) next.fields = walk(next.fields, inSection)
    if (next.tabs) next.tabs = next.tabs.map((t) => ({ ...t, fields: walk(t.fields, inSection) }))
    if (next.blocks) next.blocks = next.blocks.map((b) => ({ ...b, fields: walk(b.fields, true) }))
    if (inSection && !next.virtual) next = deferred(next)
    return next
  })

export const deferSectionValidation = (config: Config): Config =>
  config.collections
    ? {
        ...config,
        collections: config.collections.map((collection) => ({
          ...collection,
          fields: walk(collection.fields as AnyField[], false) as typeof collection.fields,
        })),
      }
    : config
