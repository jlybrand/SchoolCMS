import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Reads design tokens out of `src/styles/tokens.css`.
 *
 * Test-only, deliberately. Production never parses CSS to learn token values — at render
 * the browser resolves them, and the Phase 4 `theme` global validates a tenant's overrides
 * from its own field values. What the token suite needs is the *shipped defaults*, and the
 * only honest source for those is the stylesheet itself. A TypeScript mirror of the token
 * values would pass its own test while the CSS drifted.
 */

const TOKENS_CSS = fileURLToPath(new URL('../../src/styles/tokens.css', import.meta.url))

export type TokenBlock = {
  /** The selector list as authored, e.g. `:root` or `:root:lang(zh-Hans), :root:lang(ko)`. */
  readonly selector: string
  readonly tokens: Readonly<Record<string, string>>
}

const CUSTOM_PROPERTY = /(--[\w-]+)\s*:\s*([^;]+);/g

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Top-level rule blocks, in source order. Nested at-rules are not expected in the token
 * file; if one is added, its declarations are attributed to the enclosing block, which is
 * close enough for the assertions here and will read oddly enough to prompt a fix.
 */
export const readTokenBlocks = (): TokenBlock[] => {
  const css = stripComments(readFileSync(TOKENS_CSS, 'utf8'))
  const blocks: TokenBlock[] = []

  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').trim().replace(/\s+/g, ' ')
    const body = match[2] ?? ''
    const tokens: Record<string, string> = {}

    for (const declaration of body.matchAll(CUSTOM_PROPERTY)) {
      const name = declaration[1]
      const value = declaration[2]
      if (name && value) tokens[name] = value.trim().replace(/\s+/g, ' ')
    }

    blocks.push({ selector, tokens })
  }

  return blocks
}

/** The `:root` defaults — what every tenant gets before its theme overrides anything. */
export const readRootTokens = (): Readonly<Record<string, string>> =>
  readTokenBlocks().find((block) => block.selector === ':root')?.tokens ?? {}

/** Blocks scoped to a language, keyed for the per-locale typography assertions (`08` §7). */
export const readLocaleTokenBlocks = (): TokenBlock[] =>
  readTokenBlocks().filter((block) => block.selector.includes(':lang('))

/** Every locale named in a `:lang()` selector, deduplicated. */
export const localesWithTypographyOverrides = (): string[] => [
  ...new Set(
    readLocaleTokenBlocks().flatMap((block) =>
      [...block.selector.matchAll(/:lang\(([^)]+)\)/g)].map((match) => (match[1] ?? '').trim()),
    ),
  ),
]
