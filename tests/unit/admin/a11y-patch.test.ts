// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { repairAdminA11y } from '@/admin/A11yPatch/repairs'

/**
 * Repairs to Payload's admin markup (`docs/phases/04` §17). Fixtures are cut from Payload 3.87's
 * real output (sampled 2026-10-27), SVGs removed. Every repair adds an attribute and nothing
 * else: React owns these nodes, so moving or replacing one would break its reconciliation.
 */

const render = (html: string) => {
  document.body.innerHTML = html
  repairAdminA11y(document)
}

const $ = (selector: string) => document.querySelector(selector)!

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('unnamed buttons', () => {
  it('names the document controls "⋯" button', () => {
    render(
      '<div class="doc-controls"><div class="popup doc-controls__popup"><div class="popup__trigger-wrap"><button class="popup-button" type="button"><div class="doc-controls__dots"><div></div></div></button></div></div></div>',
    )
    expect($('.popup-button').getAttribute('aria-label')).toBe('More actions')
  })

  it('leaves a popup button that already has words alone', () => {
    render(
      '<div class="per-page"><button class="popup-button" type="button"><span>Per Page: 10</span></button></div>',
    )
    expect($('.popup-button').hasAttribute('aria-label')).toBe(false)
  })

  it.each([
    ['bold', 'Bold'],
    ['italic', 'Italic'],
    ['link', 'Link'],
    ['strikethrough', 'Strikethrough'],
    ['inlineCode', 'Inline code'],
  ])('names the rich-text %s button from its key', (key, label) => {
    render(
      `<button class="toolbar-popup__button toolbar-popup__button-${key}" data-button-key="${key}" type="button"><svg></svg></button>`,
    )
    expect($('button').getAttribute('aria-label')).toBe(label)
  })

  it('names a date’s clear button after its field — an "×" with no words (events, 2026-11-11)', () => {
    render(
      '<div class="field-type date-time-field"><label class="field-label">Starts<span class="required">*</span></label><div class="date-time-picker"><div class="date-time-picker__icon-wrap"><button class="date-time-picker__clear-button" type="button"></button></div></div></div>',
    )
    expect($('.date-time-picker__clear-button').getAttribute('aria-label')).toBe('Clear Starts')
  })

  it('a date’s clear button outside a labelled field is still named', () => {
    render('<button class="date-time-picker__clear-button" type="button"></button>')
    expect($('button').getAttribute('aria-label')).toBe('Clear date')
  })

  it('names the pagination arrows', () => {
    render(
      '<div class="paginator"><button class="clickable-arrow clickable-arrow--is-disabled clickable-arrow--left" disabled type="button"></button><button class="clickable-arrow clickable-arrow--right" type="button"></button></div>',
    )
    expect($('.clickable-arrow--left').getAttribute('aria-label')).toBe('Previous page')
    expect($('.clickable-arrow--right').getAttribute('aria-label')).toBe('Next page')
  })
})

describe('the list view’s “someone is editing this” lock', () => {
  /**
   * Payload 3.87's `Locked`: a focusable `role="button"` whose only words are a tooltip shown on
   * hover. Found when a school had an announcement open while the district looked at the list.
   */
  it('takes its name from the tooltip — who is editing', () => {
    render(
      '<div class="locked" role="button" tabindex="0"><div class="tooltip locked__tooltip tooltip--show-false">e2e-school-a@example.invalid is editing</div></div>',
    )
    expect($('.locked').getAttribute('aria-label')).toBe('e2e-school-a@example.invalid is editing')
  })

  it('says someone is editing when the tooltip has no words', () => {
    render('<div class="locked" role="button" tabindex="0"></div>')
    expect($('.locked').getAttribute('aria-label')).toBe('Someone else is editing this')
  })
})

/**
 * A row of a blocks or array field — a news feed in a composed page's layout, a social link in
 * settings. Payload 3.87 leaves three of its controls without a name. Found 2026-10-28 when the
 * whole-screen gate first opened a composed page with a block in it.
 */
describe('block and array rows', () => {
  it('names the drag handle — a focusable "sortable" button with no words', () => {
    render(
      '<div class="collapsible__drag" role="button" tabindex="0" aria-disabled="false" aria-roledescription="sortable"></div>',
    )
    expect($('.collapsible__drag').getAttribute('aria-label')).toBe('Reorder')
  })

  it('names the row’s "⋯" actions menu', () => {
    render(
      '<div class="popup array-actions"><div class="popup__trigger-wrap"><button class="popup-button array-actions__button popup-button--default" type="button"></button></div></div>',
    )
    expect($('.array-actions__button').getAttribute('aria-label')).toBe('Row actions')
  })

  it('names the copy-and-paste menu', () => {
    render(
      '<div class="popup clipboard-action__popup"><div class="popup__trigger-wrap"><button class="popup-button popup-button--default" type="button"></button></div></div>',
    )
    expect($('.clipboard-action__popup .popup-button').getAttribute('aria-label')).toBe(
      'Copy or paste',
    )
  })
})

describe('unlabelled inputs take their field’s label', () => {
  it('a relationship combobox', () => {
    render(
      '<div class="field-type relationship" id="field-parent"><label class="field-label" for="field-parent">Parent</label><div class="field-type__wrap"><div class="react-select"><div class="rs__control"><input class="rs__input" id="react-select-x-input" role="combobox" type="text"></div></div></div></div>',
    )
    expect($('input').getAttribute('aria-label')).toBe('Parent')
  })

  it('drops the required marker from the label text', () => {
    render(
      '<div class="field-type"><label class="field-label">Tenant<span class="required">*</span></label><div class="react-select"><input class="rs__input" role="combobox"></div></div>',
    )
    expect($('input').getAttribute('aria-label')).toBe('Tenant')
  })

  it('the date picker', () => {
    render(
      '<div class="field-type date-time-field"><label class="field-label">Publish at</label><div class="field-type__wrap" id="field-publishAt"><div class="react-datepicker__input-container"><input class="" type="text" value=""></div></div></div>',
    )
    expect($('input').getAttribute('aria-label')).toBe('Publish at')
  })

  it('the rich-text editing area', () => {
    render(
      '<div class="field-type rich-text-lexical"><label class="field-label">Body</label><div class="rich-text-lexical__wrap"><div class="ContentEditable__root" contenteditable="true" role="textbox"></div></div></div>',
    )
    expect($('.ContentEditable__root').getAttribute('aria-label')).toBe('Body')
  })

  it('the dashboard breadcrumb view switcher, which has no field', () => {
    render(
      '<div class="dashboard-breadcrumb-select react-select"><div class="rs__control"><input id="react-select-r1-input" role="combobox" aria-readonly="true"></div></div>',
    )
    expect($('input').getAttribute('aria-label')).toBe('Choose a view')
  })

  it('never overwrites a name that is already there', () => {
    render(
      '<div class="field-type"><label class="field-label">Parent</label><input class="rs__input" role="combobox" aria-label="Pick a parent"></div>',
    )
    expect($('input').getAttribute('aria-label')).toBe('Pick a parent')
  })

  it('leaves an input with no field label and no known role unnamed, rather than guessing', () => {
    render('<div class="react-select"><input class="rs__input" role="combobox"></div>')
    expect($('input').hasAttribute('aria-label')).toBe(false)
  })
})

describe('list-view row checkboxes', () => {
  it('names each row’s checkbox after the row’s first link', () => {
    render(
      '<table><tbody><tr data-id="316"><td class="cell-_select"><div class="select-row"><input aria-label="" type="checkbox"></div></td><td class="cell-title"><a href="/admin/collections/pages/316">Contact Us</a></td></tr></tbody></table>',
    )
    expect($('input').getAttribute('aria-label')).toBe('Select Contact Us')
  })

  it('falls back to a plain name when the row has no link', () => {
    render(
      '<table><tbody><tr><td class="cell-_select"><div class="select-row"><input aria-label="" type="checkbox"></div></td><td>—</td></tr></tbody></table>',
    )
    expect($('input').getAttribute('aria-label')).toBe('Select row')
  })
})

describe('hidden but focusable', () => {
  it('takes react-select’s aria-hidden indicators out of the tab order', () => {
    render(
      '<div class="rs__indicators"><div class="clear-indicator" aria-hidden="true" role="button" tabindex="0"></div><button class="dropdown-indicator" aria-hidden="true" type="button"></button></div>',
    )
    expect($('.clear-indicator').getAttribute('tabindex')).toBe('-1')
    expect($('.dropdown-indicator').getAttribute('tabindex')).toBe('-1')
  })
})

describe('the document tabs list', () => {
  it('stops presenting a list whose items are not list items', () => {
    render(
      '<ul class="doc-tabs__tabs"><div class="doc-tab" aria-label="Edit">Edit</div><a class="doc-tab" href="/v">Versions</a></ul>',
    )
    expect($('.doc-tabs__tabs').getAttribute('role')).toBe('none')
  })

  it('leaves a tabs list made of real list items alone', () => {
    render('<ul class="doc-tabs__tabs"><li><a href="/v">Versions</a></li></ul>')
    expect($('.doc-tabs__tabs').hasAttribute('role')).toBe(false)
  })
})

/**
 * Live Preview (Jason, 2026-11-10). Its frame has no title and its size boxes no label — both
 * found by axe on the page form with the preview open, sampled from Payload 3.87.
 */
describe('Live Preview', () => {
  it('titles the preview frame', () => {
    render('<iframe class="iframe-loader__iframe" id="live-preview-iframe" src="/x"></iframe>')
    expect($('#live-preview-iframe').getAttribute('title')).toBe('Page preview')
  })

  it('names the width and height boxes', () => {
    render(
      '<input class="toolbar-input" type="number" value="795" name="live-preview-width" /><input class="toolbar-input" type="number" value="909" name="live-preview-height" />',
    )
    expect($('[name="live-preview-width"]').getAttribute('aria-label')).toBe('Preview width')
    expect($('[name="live-preview-height"]').getAttribute('aria-label')).toBe('Preview height')
  })

  it('says whether the toggle is on — a two-state button with no state is 4.1.2', () => {
    render('<button class="live-preview-toggler" type="button" aria-label="Live Preview"></button>')
    expect($('.live-preview-toggler').getAttribute('aria-pressed')).toBe('false')
    $('.live-preview-toggler').classList.add('live-preview-toggler--active')
    repairAdminA11y(document)
    expect($('.live-preview-toggler').getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps a title Payload gives the frame', () => {
    render('<iframe id="live-preview-iframe" title="Theirs"></iframe>')
    expect($('#live-preview-iframe').getAttribute('title')).toBe('Theirs')
  })
})

describe('idempotent', () => {
  it('a second pass changes nothing', () => {
    document.body.innerHTML =
      '<div class="doc-controls"><button class="popup-button" type="button"><div></div></button></div>'
    repairAdminA11y(document)
    const after = document.body.innerHTML
    repairAdminA11y(document)
    expect(document.body.innerHTML).toBe(after)
  })
})
