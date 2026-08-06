import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

/**
 * GUARDRAIL 2 — CSS logical properties only (`07` §3, `08` §7, `05` Phase 0).
 *
 * RTL support for Arabic depends on this from the first component. It is nearly free if
 * done from the start and expensive to retrofit across a finished component library, which
 * is exactly why it is a Phase 0 gate rather than a Phase 7 cleanup.
 *
 * As above, this tests the rule, not the stylesheets.
 */

async function warningsFor(code: string) {
  const result = await stylelint.lint({ code, codeFilename: 'src/styles/probe.css' })
  return result.results[0]?.warnings ?? []
}

describe('logical-properties guard', () => {
  describe('rejects physical box properties', () => {
    const banned = [
      'margin-left: 1rem;',
      'margin-right: 1rem;',
      'padding-left: 1rem;',
      'padding-right: 1rem;',
      'border-left: 1px solid red;',
      'border-top-left-radius: 4px;',
      'left: 0;',
      'right: 0;',
      'width: 100%;',
      'height: 4rem;',
      'max-width: 60ch;',
      'overflow-x: hidden;',
    ]

    it.each(banned)('rejects `%s`', async (decl) => {
      const warnings = await warningsFor(`.a { ${decl} }`)
      expect(warnings).not.toHaveLength(0)
    })
  })

  describe('rejects physical direction keywords', () => {
    const banned = ['text-align: left;', 'text-align: right;', 'float: left;', 'clear: right;']

    it.each(banned)('rejects `%s`', async (decl) => {
      const warnings = await warningsFor(`.a { ${decl} }`)
      expect(warnings).not.toHaveLength(0)
    })
  })

  describe('accepts logical equivalents', () => {
    const allowed = [
      'margin-inline-start: 1rem;',
      'margin-inline: auto;',
      'padding-block: 1rem;',
      'padding-inline-start: 1.5rem;',
      'border-inline-start: 1px solid red;',
      'border-start-start-radius: 4px;',
      'inset-inline-start: 0;',
      'inline-size: 100%;',
      'block-size: 4rem;',
      'max-inline-size: 60ch;',
      'overflow-inline: hidden;',
      'text-align: start;',
      'text-align: center;',
      'float: inline-start;',
    ]

    it.each(allowed)('accepts `%s`', async (decl) => {
      const warnings = await warningsFor(`.a { ${decl} }`)
      expect(warnings).toHaveLength(0)
    })
  })

  it('passes the real stylesheets in src/styles', async () => {
    const result = await stylelint.lint({ files: 'src/styles/*.css' })
    const warnings = result.results.flatMap((r) => r.warnings)
    expect(warnings).toEqual([])
  })
})
