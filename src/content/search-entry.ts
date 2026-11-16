import { relationshipIdOf } from '@/access/predicates'

import { toRichText } from './rich-text'
import type { RichText, RichTextInline, RichTextList } from './types'

/**
 * What the search index holds for a document (Jason, 2026-11-16; Phase 6 D). PURE: the search
 * plugin's `beforeSync` (src/payload.config.ts) calls it with the document being published.
 *
 * - EVERY AUTHORED WORD goes in — a page's sections (Columns included), an announcement's
 *   headline, summary and body, an event's location and notes, a document's description — and
 *   nothing a visitor cannot see.
 * - An entry that must not be found is still written, with `excluded: true`, and the query skips
 *   it. The plugin never REMOVES an entry it is told to skip, so a live announcement switched to
 *   staff-only would otherwise stay findable. Excluded: staff-only pages and announcements, a page
 *   marked "Hide from site search", an image, and anything with no site or title.
 * - An announcement's REACH (`syndication`) is copied as the query needs it: `reachAll` for
 *   district-wide, `reachSites` for chosen sites. A feed reads the same field (`syndication.ts`).
 * - An event's `lastDate` is when it last happens — the query leaves out events over a year ago.
 * - Drafts never get here: the plugin syncs published documents only.
 */

export type SearchCollection = 'pages' | 'posts' | 'events' | 'resources'
export type SearchKind = 'page' | 'post' | 'event' | 'document'

export type SearchEntry = {
  tenant: string | null
  kind: SearchKind
  title: string
  text: string
  excluded: boolean
  reachAll: boolean
  reachSites: string[]
  lastDate: string | null
  /** A document's file. Everything else's address is worked out when it is found. */
  href: string | null
}

type Row = Record<string, unknown>

/** Enough for any page DD2 writes; a pasted novel is cut rather than indexed whole. */
const MAX_TEXT = 50_000

const KIND: Record<SearchCollection, SearchKind> = {
  pages: 'page',
  posts: 'post',
  events: 'event',
  resources: 'document',
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const rows = (value: unknown): Row[] =>
  Array.isArray(value)
    ? value.filter((r): r is Row => typeof r === 'object' && r !== null && !Array.isArray(r))
    : []

const inline = (nodes: readonly RichTextInline[]): string =>
  nodes
    .map((node) =>
      node.kind === 'link' ? node.children.map((child) => child.text).join('') : node.text,
    )
    .join('')

const listText = (list: RichTextList): string[] =>
  list.items.flatMap((item) => [inline(item.children), ...(item.list ? listText(item.list) : [])])

/** A rich-text document's words, block by block. */
const richWords = (richText: RichText): string[] =>
  richText.flatMap((block) => (block.kind === 'list' ? listText(block) : [inline(block.children)]))

const lexicalWords = (state: unknown): string[] => richWords(toRichText(state))

/** The text fields every section kind may carry; data sections contribute only their heading. */
const SECTION_TEXT = ['heading', 'subheading', 'text', 'linkLabel', 'caption', 'title'] as const

const sectionWords = (section: Row): string[] => {
  const words: string[] = SECTION_TEXT.map((key) => str(section[key])).filter(
    (w): w is string => w !== null,
  )
  if (section.blockType === 'richText') words.push(...lexicalWords(section.content))
  for (const card of rows(section.cards))
    words.push(...[str(card.title), str(card.text)].filter((w): w is string => w !== null))
  for (const item of rows(section.items)) {
    const heading = str(item.heading)
    if (heading) words.push(heading)
    words.push(...lexicalWords(item.content))
  }
  for (const column of rows(section.columns)) {
    const heading = str(column.heading)
    if (heading) words.push(heading)
    for (const inner of rows(column.content)) words.push(...sectionWords(inner))
  }
  return words
}

const wordsOf = (collection: SearchCollection, doc: Row): string[] => {
  switch (collection) {
    case 'pages':
      return rows(doc.layout).flatMap(sectionWords)
    case 'posts':
      return [str(doc.excerpt), ...lexicalWords(doc.body)].filter((w): w is string => w !== null)
    case 'events':
      return [str(doc.location), ...lexicalWords(doc.notes)].filter((w): w is string => w !== null)
    case 'resources':
      return [str(doc.description)].filter((w): w is string => w !== null)
  }
}

const join = (words: readonly string[]): string =>
  words
    .map((w) => w.replace(/\s+/g, ' ').trim())
    .filter((w) => w !== '')
    .join('\n')
    .slice(0, MAX_TEXT)

const reachOf = (doc: Row): { reachAll: boolean; reachSites: string[] } => {
  const syndication = (doc.syndication ?? {}) as Row
  if (syndication.scope === 'district-wide') return { reachAll: true, reachSites: [] }
  if (syndication.scope !== 'selected') return { reachAll: false, reachSites: [] }
  const sites = (Array.isArray(syndication.syndicatedTo) ? syndication.syndicatedTo : [])
    .map((s) => relationshipIdOf(s as never))
    .filter((s): s is string => s !== null)
  return { reachAll: false, reachSites: sites }
}

export const toSearchEntry = (collection: SearchCollection, doc: Row): SearchEntry => {
  const tenant = relationshipIdOf(doc.tenant as never)
  const title = str(doc.title) ?? ''
  const hidden =
    ((collection === 'pages' || collection === 'posts') && doc.visibility === 'staff') ||
    (collection === 'pages' && doc.hideFromSiteSearch === true) ||
    (collection === 'resources' && doc.kind !== 'document')

  return {
    tenant,
    kind: KIND[collection],
    title,
    text: join(wordsOf(collection, doc)),
    excluded: hidden || tenant === null || title === '',
    ...(collection === 'posts' ? reachOf(doc) : { reachAll: false, reachSites: [] }),
    lastDate:
      collection === 'events' ? (str(doc.repeatUntil) ?? str(doc.end) ?? str(doc.start)) : null,
    href: collection === 'resources' ? str(doc.url) : null,
  }
}
