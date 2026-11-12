/**
 * The district's Page settings (Jason, 2026-10-29) — the fields its gear opens, as Finalsite's
 * page-settings modal holds them. In tabs since 2026-11-11 (Jason: "instead of one long form
 * that runs off screen"): Page · Linking · SEO · Access.
 *
 * Each such field carries `SETTING_CLASS` and its tab's class (`settingClass`). For the district
 * the toolbar turns the form into the dialog that shows only these, one tab at a time; for a
 * school manager, who has no toolbar, they stay where they always were (Jason: the school plane
 * is unchanged).
 *
 * The Start (`publishAt`) is no longer a setting: it moves to publishing (Jason, 2026-11-11).
 * The permanent link carries `SETTING_CLASS` and no tab, so it is in neither the page nor the
 * dialog — Jason: the address bar shows it.
 */

export const SETTING_CLASS = 'dd2-page-setting'

export type SettingsTab = 'page' | 'linking' | 'seo' | 'access'

/** The tabs, in order, and which settings each holds (form paths). */
export const SETTING_TABS: readonly {
  id: SettingsTab
  label: string
  paths: readonly string[]
}[] = [
  {
    id: 'page',
    label: 'Page',
    paths: [
      'title',
      'slug',
      'parent',
      'hideFromNavigation',
      'hideFromSiteSearch',
      'hideFromSearchEngines',
    ],
  },
  {
    id: 'linking',
    label: 'Linking',
    paths: ['linkMode', 'linkTo', 'linkTarget', 'districtLinkTarget'],
  },
  { id: 'seo', label: 'SEO', paths: ['meta.title', 'meta.description'] },
  { id: 'access', label: 'Access', paths: ['visibility'] },
]

/** Form paths of the settings, so a failed save on one of them can open the dialog. */
export const SETTING_PATHS: readonly string[] = SETTING_TABS.flatMap((tab) => tab.paths)

/** The tab holding a setting, or null for a path that is not one. Pure. */
export const tabFor = (path: string): SettingsTab | null =>
  SETTING_TABS.find((tab) => tab.paths.includes(path))?.id ?? null

/** The class a tab's fields carry; the dialog shows the open tab's only (`page-settings.css`). */
export const tabClass = (tab: SettingsTab) => `dd2-settings-tab-${tab}`

/** Both classes a setting declares in `src/collections/Pages.ts`. */
export const settingClass = (tab: SettingsTab) => `${SETTING_CLASS} ${tabClass(tab)}`

/** The first tab, in tab order, holding a refused setting — the one the dialog opens on. Pure. */
export const firstRefusedTab = (refused: readonly string[]): SettingsTab | null =>
  SETTING_TABS.find((tab) => tab.paths.some((path) => refused.includes(path)))?.id ?? null

/**
 * Where a key press on a tab moves (the WAI-ARIA tabs pattern): the arrows along the row,
 * wrapping, reversed in a right-to-left admin; Home and End to the ends. Null for any other key.
 * Pure.
 */
export const tabAfterKey = (
  current: SettingsTab,
  key: string,
  direction: 'ltr' | 'rtl',
): SettingsTab | null => {
  const ids = SETTING_TABS.map((tab) => tab.id)
  const at = ids.indexOf(current)
  const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
  const back = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
  if (key === forward) return ids[(at + 1) % ids.length] ?? null
  if (key === back) return ids[(at - 1 + ids.length) % ids.length] ?? null
  if (key === 'Home') return ids[0] ?? null
  if (key === 'End') return ids[ids.length - 1] ?? null
  return null
}

/** The window event the dialog's own buttons send the toolbar, which owns the dialog. */
export const SETTINGS_EVENT = 'dd2:page-settings'
export type SettingsEventDetail = 'close'

/** The toolbar telling the dialog's heading why it stayed open — the missing setting's label. */
export const REFUSED_EVENT = 'dd2:page-settings-refused'

/** The toolbar asking the dialog's tabs to show one — a refused setting's. */
export const TAB_EVENT = 'dd2:page-settings-tab'

export const HEADING_ID = 'page-settings-title'
/** The element the toolbar makes the tab panel: the main column's fields. */
export const PANEL_ID = 'page-settings-panel'
export const tabId = (tab: SettingsTab) => `page-settings-tab-${tab}`

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
