/**
 * Repairs to Payload's own admin markup (written against 3.87; every repair re-checked by the
 * whole-screen axe suite on 3.93.0, 2026-11-11) where it fails axe (`docs/phases/04` §17, `04` §6,
 * CLAUDE.md rule 6). `A11yPatch.tsx` runs this on load and after every DOM change.
 *
 * A STOPGAP, NOT A FORK. Each repair is reported upstream; delete it when Payload fixes the
 * markup. `tests/e2e/admin-planes-axe.spec.ts` fails if a Payload bump renames what a repair
 * looks for, so a repair cannot silently stop working.
 *
 * ATTRIBUTES ONLY. React owns these nodes: moving, wrapping or replacing one breaks its
 * reconciliation, so every repair sets an attribute and touches nothing else. Never
 * overwrites a name that is already there, and a second pass changes nothing.
 *
 * Names come from the words already on screen (the field's label, the row's title) so a
 * screen-reader user hears what a sighted user reads; a fixed name is used only where the
 * control has no visible words at all (an icon button).
 */

const hasName = (el: Element) => {
  const label = el.getAttribute('aria-label')
  return (label !== null && label.trim() !== '') || el.hasAttribute('aria-labelledby')
}

const name = (el: Element | null | undefined, label: string | null | undefined) => {
  if (!el || !label || hasName(el)) return
  el.setAttribute('aria-label', label)
}

/** The visible label of the Payload field `el` sits in, without the required marker. */
const fieldLabel = (el: Element): string | null => {
  const label = el.closest('.field-type')?.querySelector('label.field-label')
  if (!label) return null
  const copy = label.cloneNode(true) as Element
  copy.querySelectorAll('.required').forEach((marker) => marker.remove())
  const text = copy.textContent?.replace(/\s+/g, ' ').trim()
  return text || null
}

/** `inlineCode` → "Inline code". */
const words = (key: string) => {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * The editor toolbar's buttons in a school manager's words (Jason, 2026-11-19), by Payload's key.
 * A key not here is named from the key itself (`words`).
 */
const TOOLBAR_NAMES: Readonly<Record<string, string>> = {
  upload: 'Insert an image',
  horizontalRule: 'Insert a line',
  paragraph: 'Normal text',
  h2: 'Heading',
  h3: 'Subheading',
  h4: 'Minor heading',
  unorderedList: 'Bulleted list',
  orderedList: 'Numbered list',
  blockquote: 'Quotation',
}

const all = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector))

export const repairAdminA11y = (root: ParentNode): void => {
  // 4.1.2 — the file library's upload controls (2026-11-13): icon-only buttons beside a file.
  // The copy button's only words are its hidden tooltip ("Copy"), which names nothing.
  for (const button of all(root, 'button.copy-to-clipboard'))
    name(button, 'Copy the file’s address')
  for (const button of all(root, 'button.file-details__remove')) {
    if (button.textContent?.trim() === '') name(button, 'Remove the file')
  }

  // 4.1.2 — an upload field's chosen file (the Image and Hero blocks): two icon-only buttons.
  // "Remove" takes the file out of the field; the file itself stays in the library.
  for (const button of all(root, 'button.upload-relationship-details__edit')) {
    if (button.textContent?.trim() === '') name(button, 'Edit the file’s details')
  }
  for (const button of all(root, 'button.upload-relationship-details__remove')) {
    if (button.textContent?.trim() === '') name(button, 'Take the file out of this section')
  }

  // 4.1.2 — the document controls' "⋯" menu: three dots, no words.
  for (const button of all(root, '.doc-controls .popup-button')) {
    if (button.textContent?.trim() === '') name(button, 'More actions')
  }

  // 4.1.2 — rich-text toolbar icon buttons, named in plain words (`TOOLBAR_NAMES`, Jason
  // 2026-11-19: "a better toolbar") or from Payload's own key, and shown on hover too.
  for (const button of all(root, 'button.toolbar-popup__button[data-button-key]')) {
    const key = button.getAttribute('data-button-key') ?? ''
    const label = TOOLBAR_NAMES[key] ?? words(key)
    name(button, label)
    if (!button.hasAttribute('title') && label) button.setAttribute('title', label)
  }
  // The align menu: Payload names it "align dropdown".
  for (const button of all(root, 'button.toolbar-popup__dropdown-align')) {
    if (button.getAttribute('aria-label') !== 'Align text') {
      button.setAttribute('aria-label', 'Align text')
      button.setAttribute('title', 'Align text')
    }
  }

  // 4.1.2 — the list's "someone is editing this" lock: a focusable button whose only words are
  // a hover tooltip.
  for (const lock of all(root, '.locked[role="button"]')) {
    const tip = lock.querySelector('.locked__tooltip')?.textContent?.trim()
    name(lock, tip || 'Someone else is editing this')
  }

  // 4.1.2 — a block or array row's controls (found on a composed page with a news feed): the
  // drag handle is a focusable "sortable" button with no words, and two "⋯" menus are icons.
  for (const handle of all(root, '.collapsible__drag[role="button"]')) name(handle, 'Reorder')
  for (const button of all(root, '.array-actions__button')) name(button, 'Row actions')
  for (const button of all(root, '.clipboard-action__popup .popup-button')) {
    name(button, 'Copy or paste')
  }

  // 4.1.2 — a date's clear button: an "×" icon, shown once the date has a value (an event's
  // Starts and Ends, 2026-11-11). Named after the field, so "Clear Starts" and "Clear Ends" differ.
  for (const button of all(root, 'button.date-time-picker__clear-button')) {
    const label = fieldLabel(button)
    name(button, label ? `Clear ${label}` : 'Clear date')
  }

  // 4.1.2 — list pagination arrows.
  for (const button of all(root, '.clickable-arrow--left')) name(button, 'Previous page')
  for (const button of all(root, '.clickable-arrow--right')) name(button, 'Next page')

  // 1.3.1 / 4.1.2 — inputs Payload renders beside a visible label it does not associate.
  for (const input of all(
    root,
    '.react-select input[role="combobox"], .react-datepicker__input-container input, .ContentEditable__root[role="textbox"]',
  )) {
    name(input, fieldLabel(input))
  }

  // The dashboard's breadcrumb view switcher sits in no field, so it has no label to borrow.
  for (const input of all(root, '.dashboard-breadcrumb-select input[role="combobox"]')) {
    name(input, 'Choose a view')
  }

  // 1.3.1 / 4.1.2 — list-view row checkboxes ship `aria-label=""`.
  for (const box of all(root, 'tr .select-row input[type="checkbox"]')) {
    const title = box.closest('tr')?.querySelector('a')?.textContent?.trim()
    name(box, title ? `Select ${title}` : 'Select row')
  }

  // 4.1.2 — react-select marks its indicators `aria-hidden` yet leaves them focusable.
  for (const indicator of all(root, '.rs__indicators [aria-hidden="true"]')) {
    if (indicator.getAttribute('tabindex') !== '-1') indicator.setAttribute('tabindex', '-1')
  }

  // 4.1.2 — Live Preview (Jason, 2026-11-10): the frame has no title, the size boxes no label.
  for (const frame of all(root, 'iframe#live-preview-iframe')) {
    if (!frame.getAttribute('title')?.trim()) frame.setAttribute('title', 'Page preview')
  }
  // The toggle is a two-state button that never says which state it is in. Its state is its
  // class, so this one repair FOLLOWS the class rather than setting once (`A11yPatch` re-runs on
  // class changes for it); it never changes a class, so it cannot retrigger itself.
  for (const button of all(root, 'button.live-preview-toggler')) {
    const pressed = String(button.classList.contains('live-preview-toggler--active'))
    if (button.getAttribute('aria-pressed') !== pressed)
      button.setAttribute('aria-pressed', pressed)
  }
  for (const input of all(root, 'input[name="live-preview-width"]')) name(input, 'Preview width')
  for (const input of all(root, 'input[name="live-preview-height"]')) name(input, 'Preview height')

  // 1.3.1 — the document tabs are a `ul` of `div`s and `a`s. Not a list to a screen reader.
  for (const list of all(root, 'ul.doc-tabs__tabs')) {
    const notItems = Array.from(list.children).some((child) => child.tagName !== 'LI')
    if (notItems && !list.hasAttribute('role')) list.setAttribute('role', 'none')
  }
}
