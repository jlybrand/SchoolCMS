/**
 * The district's Page settings (Jason, 2026-10-29) — the fields its gear opens, as Finalsite's
 * page-settings modal holds them: title, address, place, who can see it, search and
 * sharing, scheduled publish, the permanent link, the linked-page choice and the hide options.
 *
 * Each such field carries `SETTING_CLASS`. For the district the toolbar turns the form into
 * the dialog that shows only these; for a school manager, who has no toolbar, they stay where
 * they always were (Jason: the school plane is unchanged).
 */

export const SETTING_CLASS = 'dd2-page-setting'

/** Form paths of the settings, so a failed save on one of them can open the dialog. */
export const SETTING_PATHS: readonly string[] = [
  'title',
  'slug',
  'parent',
  'visibility',
  'meta.title',
  'meta.description',
  'publishAt',
  'linkMode',
  'linkTo',
  'linkTarget',
  'districtLinkTarget',
  'hideFromNavigation',
  'hideFromSearchEngines',
]

/** The window event the dialog's own buttons send the toolbar, which owns the dialog. */
export const SETTINGS_EVENT = 'dd2:page-settings'
export type SettingsEventDetail = 'close'

/** The toolbar telling the dialog's heading why it stayed open — the missing setting's label. */
export const REFUSED_EVENT = 'dd2:page-settings-refused'

export const HEADING_ID = 'page-settings-title'

/**
 * The settings a page cannot be without. The dialog will not close on an empty one: with
 * autosave on, an empty title is not refused by a save anyone sees — the autosave quietly fails
 * and Publish greys out — so the dialog is the only place left to say so.
 */
export const REQUIRED_SETTINGS: readonly { path: string; label: string }[] = [
  { path: 'title', label: 'a title' },
  { path: 'slug', label: 'an address' },
]

/** The first required setting left empty, or null. Pure. */
export const missingRequired = (values: Readonly<Record<string, unknown>>) =>
  REQUIRED_SETTINGS.find(({ path }) => {
    const value = values[path]
    return typeof value !== 'string' || value.trim() === ''
  }) ?? null
