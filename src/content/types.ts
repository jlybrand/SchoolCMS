/**
 * DD2 DOMAIN TYPES — hand-written, never generated from Payload (`02` §11, ADR-5).
 *
 * This is the vocabulary the entire rendering layer speaks. Components, templates, and the
 * translation pipeline consume these and nothing else. The mapping from Payload's generated
 * types happens exactly once, inside `src/content/*`.
 *
 * Swapping the CMS means rewriting ~8 files in this directory, not ~200 components. That
 * property only survives if these types stay hand-written — the moment they are generated
 * from Payload, the boundary is decorative.
 *
 * PHASE 0 SCOPE: only the types the tenancy spine needs. Each content module adds its own
 * types in its own phase (`05`). Do not add speculative shapes here.
 */

/** Locale tiers per `08` §2. `en` is the only authored language. */
export type Locale = string

export type TenantType = 'district' | 'school'

export type Tenant = {
  id: string
  slug: string
  name: string
  /** Drives routing. Resolved from the request Host at the edge (`02` §4.1). */
  hostname: string
  type: TenantType
}

/** Public vs. staff-gated content (`01` §4.3). Staff requires a valid Entra session. */
export type Visibility = 'public' | 'staff'

/**
 * Every content-access function takes this. Tenant is resolved from the hostname before
 * anything downstream runs; it is never a user-supplied parameter.
 */
export type ContentContext = {
  tenant: Tenant
  locale: Locale
}

/**
 * PAGES (`03` §2).
 *
 * `pageType` decides the editing shape: the fixed types carry typed fields a school manager
 * fills in, `composed` carries the district-only block array (§3). One enum rather than two
 * collections, so enabling school composition later (`01` §4.1) is an access-predicate
 * change and nothing else.
 */
export type PageType =
  'standard' | 'about' | 'contact' | 'staff' | 'calendar' | 'documents' | 'composed'

/** The fixed types a school manager may author. `composed` is district-only (`03` §2). */
export const FIXED_PAGE_TYPES: readonly PageType[] = [
  'standard',
  'about',
  'contact',
  'staff',
  'calendar',
  'documents',
] as const

/**
 * A page as the rendering layer sees it.
 *
 * SCOPE: identity, hierarchy, type, visibility, body prose, and — for `composed` pages —
 * the district-only block array (`03` §3).
 */
export type Page = {
  id: string
  /** Owning tenant. A page is never readable outside it unless syndicated (`03` §6.4). */
  tenantId: string
  title: string
  slug: string
  /** Full path from the site root, e.g. `/about/staff`. Assembled from the parent chain. */
  path: string
  pageType: PageType
  visibility: Visibility
  /** Parent page id, or null at the top level. Drives hierarchy and navigation. */
  parentId: string | null
  /** Gates locale publication for high-stakes content (`08` §7.1). */
  requiresTranslationReview: boolean
  /** Body prose. Empty is legitimate — see `RichText` below. */
  body: RichText
  /**
   * The block array, for `composed` pages only (`03` §3). Empty on every fixed type, which
   * is not a special case: a fixed-type page has no layout to render and the template does
   * not ask for one.
   */
  layout: PageBlock[]
}

/**
 * BLOCKS (`03` §3).
 *
 * The register in `03` §3.1 is the source of truth for what exists and in which dependency
 * batch. This union grows one member per block, and ONLY as that block is built — a member
 * declared ahead of its renderer is a shape nothing produces and nothing consumes.
 *
 * WHAT IS NOT HERE, AND MUST NOT BE:
 *
 *   - **No heading level on any block.** Levels are derived from position and threaded as a
 *     prop (`src/components/Heading/levels.ts`). The conformance claim — an editor cannot
 *     produce a heading-order violation by reordering — is true only because there is no
 *     field to set (`03` §3.2, `07` §3).
 *   - **No nesting.** No block holds other blocks. Column layouts and tabs are open
 *     questions, not omissions (`03` §3.3); resolving them yes would mean threading
 *     `baseLevel` to arbitrary depth and owning RTL column order and mobile stack order.
 *   - **No styling fields.** No alignment, no colour, no width. Per-tenant themes override
 *     tokens at render (`02` §4.4); an editor who can set a colour can fail contrast, which
 *     token-level validation exists to make impossible (`07` §3).
 */

/** Every block carries the id of its Payload array row — the render key. */
type BlockBase = {
  id: string
}

/** Prose within a composed page. The same nodes a fixed-type page's `body` carries. */
export type RichTextPageBlock = BlockBase & {
  kind: 'richText'
  content: RichText
}

/**
 * A heading, a line of text, and one link styled as a button.
 *
 * `heading` and `text` are nullable but `href` and `linkLabel` are not: the link is the
 * block, and one without a destination or an accessible name is dropped at the mapper rather
 * than rendered (WCAG 2.4.4 — see `src/content/blocks.ts`).
 *
 * `text` is a plain string rather than rich text, deliberately. A second link inside a call
 * to action competes with the button for the same decision, and the block's whole job is to
 * present one.
 */
export type CallToActionBlock = BlockBase & {
  kind: 'callToAction'
  heading: string | null
  text: string | null
  href: string
  linkLabel: string
  /** The renderer announces this; an unannounced new tab is a WCAG 3.2.5 problem. */
  newTab: boolean
}

export type PageBlock = RichTextPageBlock | CallToActionBlock

/**
 * RICH TEXT (`07` §4.4).
 *
 * Hand-written domain nodes, deliberately NOT Lexical's editor state. The renderer consumes
 * these; `src/content/rich-text.ts` maps Lexical into them exactly once. That mapping is the
 * whole reason a CMS swap costs one file rather than every template (`02` §11, ADR-5).
 *
 * The vocabulary is the `07` §4.2 allowlist and nothing else. There is no node here for
 * alignment, colour, underline or a table, because there is no way to author one — see
 * `src/lib/editor.ts`. Adding a node type to this file is a conformance decision.
 */
export type RichTextMark = 'strong' | 'em'

export type RichTextText = {
  kind: 'text'
  text: string
  marks: RichTextMark[]
}

export type RichTextLink = {
  kind: 'link'
  href: string
  /** The renderer announces this; a new tab that opens unannounced is a WCAG 3.2.5 problem. */
  newTab: boolean
  children: RichTextText[]
}

export type RichTextInline = RichTextText | RichTextLink

export type RichTextListItem = {
  children: RichTextInline[]
  /** A nested list, or null. Preserved rather than flattened — agendas nest. */
  list: RichTextList | null
}

export type RichTextList = {
  kind: 'list'
  ordered: boolean
  items: RichTextListItem[]
}

export type RichTextParagraph = {
  kind: 'paragraph'
  children: RichTextInline[]
}

/**
 * Levels 2 and 3 only. Level 1 is the page title, owned by the template — a body `h1` would
 * give the page two (`03` §3, `07` §3).
 */
export type RichTextHeading = {
  kind: 'heading'
  level: 2 | 3
  children: RichTextInline[]
}

export type RichTextBlock = RichTextParagraph | RichTextHeading | RichTextList

/** A whole rich-text document. Empty is a legitimate value, not an error. */
export type RichText = RichTextBlock[]
