/**
 * Every page composed (Jason, 2026-11-04): a page's `body` becomes a Text section.
 *
 * PURE. The public page renders the body ABOVE the sections, so the words go first and the
 * page reads the same before and after. The new section has no `id`: Payload gives it one on
 * save. A body with no words in it adds nothing — an empty Text section would fail its own
 * "Words" requirement the first time anyone saved the page.
 *
 * Used by `composeExistingPages` (`src/lib/compose-existing-pages.ts`), the one-off conversion.
 */

type Node = { type?: unknown; text?: unknown; children?: unknown }

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Nodes that are only structure or spacing: what remains is words, or something placed. */
const SPACING = new Set(['linebreak', 'tab'])

const holdsSomething = (node: Node): boolean => {
  if (node.type === 'text') return typeof node.text === 'string' && node.text.trim() !== ''
  if (Array.isArray(node.children)) return node.children.some((c) => isNode(c) && holdsSomething(c))
  // A leaf that is not text — an image, a rule — is content; a line break alone is not.
  return typeof node.type === 'string' && !SPACING.has(node.type) && node.type !== 'paragraph'
}

/** Whether a Lexical editor state has anything in it. */
export const hasWords = (body: unknown): boolean => {
  const root = isNode(body) ? (body as { root?: unknown }).root : undefined
  if (!isNode(root) || !Array.isArray(root.children)) return false
  return root.children.some((child) => isNode(child) && holdsSomething(child))
}

const rowsOf = (layout: unknown): unknown[] => (Array.isArray(layout) ? layout : [])

export type ComposedBody = { changed: boolean; layout: unknown[] }

/** The page's sections with its body as a Text section on top. */
export const composeBody = (body: unknown, layout: unknown): ComposedBody => {
  const sections = rowsOf(layout)
  if (!hasWords(body)) return { changed: false, layout: sections }
  return { changed: true, layout: [{ blockType: 'richText', content: body }, ...sections] }
}
