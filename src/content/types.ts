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
import type { NewsItem } from '@/lib/post-url'
import type { EventTiming } from '@/lib/recurrence'

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
 * Every page is composed (Jason, 2026-11-04): its words are Text sections among its other
 * components, and schools compose with the simple ones (`src/access/school-layout.ts`). There is
 * no page type and no body.
 */

/**
 * A page as another page refers to it: enough to render a link, and nothing else.
 *
 * The only structured internal link in the rendering layer — everything else an editor links
 * to is a string they typed. That makes this the single place locale-prefixed internal linking
 * lands in Phase 7 (`08` §5); today `path` is the unprefixed path, as `Page.path` is.
 */
export type PageLink = {
  id: string
  title: string
  /** Full path from the site root. Always one a resolver will actually serve — see below. */
  path: string
}

/**
 * One entry in a site menu (`03` §5).
 *
 * `href` is a string the district typed, not a page reference, for the reason
 * `CallToAction`'s is: a school menu points at the enrollment portal and the lunch-payment
 * site as often as at its own pages. It has ALREADY been through `toSafeHref` — a renderer
 * never sees a destination outside the four accepted shapes (`src/lib/href.ts`).
 *
 * NO `children`. The primary menu is flat and a section's own pages are reached from that
 * section, through `ChildPageNav`. A dropdown is a disclosure widget that needs client script
 * and a keyboard contract on every page of every site; adding one later is an additive field,
 * and taking one away is not.
 */
export type MenuLink = {
  id: string
  label: string
  href: string
  newTab: boolean
}

/**
 * A tenant's menus. Every tenant has one — a tenant with no `navigation` row has three empty
 * menus rather than a null, so the header and footer have no missing-data branch.
 */
export type Navigation = {
  /** The main menu, in the header. */
  primary: MenuLink[]
  /** Short task links above it — staff email, the parent portal. */
  utility: MenuLink[]
  footer: MenuLink[]
}

/**
 * A tenant's theme, as the custom properties it overrides (`02` §4.4).
 *
 * ALREADY VALIDATED. Every value is a `#rrggbb` that passed the contrast pairs against the
 * platform palette (`src/lib/theme.ts`); a palette that fails is absent entirely, so the
 * layout can put this on `<html>` without looking inside it. Empty means the default palette.
 * The keys come from a closed map in that file — never from the stored row.
 */
export type Theme = {
  tokens: Readonly<Record<string, string>>
}

/** The platforms a social link may point at — a closed list, so each has a known name. */
export type SocialPlatform = 'facebook' | 'instagram' | 'x' | 'youtube' | 'linkedin'

export type SocialLink = {
  id: string
  platform: SocialPlatform
  /** The platform's name, which is the link's text until an icon set exists. */
  label: string
  href: string
}

/** Words as typed, beside the link built from them (`src/lib/contact.ts`). */
export type ContactLink = {
  text: string
  href: string
}

export type ContactBlock = {
  /** One entry per line ("1 Elm St", "Summerville, SC 29483"); empty when there is no address. */
  address: string[]
  phone: ContactLink | null
  /** As typed — text, not a link: nothing dials a fax from a web page (Jason, 2026-11-18). */
  fax: string | null
  email: ContactLink | null
}

/**
 * A tenant's settings (`03` §5). Every tenant has one — a tenant with no `settings` row gets
 * the defaults rather than a null, as `Navigation` does.
 */
export type SiteSettings = {
  /** Replaces the tenant's name wherever the site names itself. Null means use the name. */
  siteTitle: string | null
  contact: ContactBlock
  social: SocialLink[]
  /** The description of last resort, for a page with none of its own (`src/lib/seo.ts`). */
  defaultDescription: string | null
  /**
   * The languages the site is served in: `['en']` until languages are handled another way
   * (Jason, 2026-11-18 — no longer a per-site setting). Kept as a list, so every reader of it is
   * ready for more.
   */
  enabledLocales: Locale[]
  /** The site's logos and thumbnails (Jason, 2026-11-18), library images; null when none. */
  logo: ImageAsset | null
  secondaryLogo: ImageAsset | null
  /** The site's share image — the picture beside a link to it (`openGraph.images`). */
  primaryThumbnail: ImageAsset | null
  secondaryThumbnail: ImageAsset | null
}

/** Where a linked page sends visitors: a path on a site, by that site's hostname. */
export type PageRedirect = { path: string; hostname: string }

export type PageSeo = {
  /** Replaces the page part of the document title. The site name is always appended. */
  title: string | null
  description: string | null
}

/**
 * A page as the rendering layer sees it.
 *
 * SCOPE: identity, hierarchy, visibility, and its sections (`03` §3).
 */
export type Page = {
  id: string
  /** Owning tenant. A page is never readable outside it unless syndicated (`03` §6.4). */
  tenantId: string
  title: string
  slug: string
  /** Full path from the site root, e.g. `/about/staff`. Assembled from the parent chain. */
  path: string
  visibility: Visibility
  /** Parent page id, or null at the top level. Drives hierarchy and navigation. */
  parentId: string | null
  /** Gates locale publication for high-stakes content (`08` §7.1). */
  requiresTranslationReview: boolean
  /**
   * What an editor wrote for search engines and link previews, or null where they wrote
   * nothing — which is the usual case, and not an error. The fallbacks (the page title, the
   * first paragraph) are applied by `src/lib/seo.ts` at render, not stored, so a page whose
   * title changes does not keep describing itself by the old one.
   */
  seo: PageSeo
  /** `noindex` and out of the sitemap (Jason, 2026-10-29). Its links are still followed. */
  hideFromSearchEngines: boolean
  /**
   * Out of the site's own search (Jason, 2026-11-11) — Phase 6 builds that search and honours
   * this. Separate from `hideFromSearchEngines`: neither implies the other.
   */
  hideFromSiteSearch: boolean
  /**
   * A linked page's target (Jason, 2026-10-29): visiting this page sends the visitor there.
   * Null on an ordinary page. A page on this site or the district site — never anywhere else.
   * The route turns it into an address in the visitor's language (`redirectHref`).
   */
  redirect: PageRedirect | null
  /**
   * A reuse page's source (Jason, 2026-10-29): the district page whose title and content this
   * page shows at its own address. Null otherwise. The page's canonical address is the source's.
   */
  reusedFrom: PageRedirect | null
  /**
   * The page's sections, top to bottom (`03` §3) — its words among them, as Text sections.
   * Empty is legitimate: a new page has none yet.
   */
  layout: PageBlock[]
  /**
   * The pages directly beneath this one, in title order (`03` §3.3, decided 2026-08-28).
   *
   * ON THE PAGE, NOT ON THE BLOCK THAT RENDERS IT. `ChildPageNav` needs this, and
   * `src/blocks/` may not import the Payload SDK (CLAUDE.md rule 1) — so rather than teach a
   * block to fetch, the page carries its own position in the tree, the way it already carries
   * its `path` and `parentId`. Breadcrumbs and a section menu want the same data.
   *
   * ONLY CHILDREN WITH A REACHABLE URL. Drafts, staff-only pages, and the front page's
   * children (whose paths would start `/home/`, which the resolver refuses) are all absent. A
   * menu entry that 404s is worse than a missing one, and it would be cached (`02` §5).
   *
   * Note what this is NOT: a general mechanism for blocks that need data. `FeedBlock`,
   * `StaffList`, `DocumentList` and `Gallery` render an editor-CONFIGURED query — a different
   * problem, decided in Phase 5 when the first of them is real (`03` §3.3).
   */
  children: readonly PageLink[]
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
 *   - **No styling fields.** No alignment, no color, no width. Per-tenant themes override
 *     tokens at render (`02` §4.4); an editor who can set a color can fail contrast, which
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
 * than rendered (WCAG 2.4.4 — see `src/content/blocks.ts`). Like a menu link's, `href` has
 * ALREADY been through `toSafeHref`.
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

/**
 * A question and its answer. `content` is rich text because answers run to lists and links;
 * `heading` is plain text because it renders inside a `<summary>`, where a link would be a
 * second interactive target competing with the disclosure itself.
 */
export type AccordionItem = {
  heading: string
  content: RichText
}

/**
 * Stacked disclosures — the FAQ shape. Items own their heading level like every other block
 * (`03` §3.2); an author writes questions, never levels.
 */
export type AccordionBlock = BlockBase & {
  kind: 'accordion'
  heading: string | null
  items: AccordionItem[]
}

/**
 * One card. `href` is optional: a card can be a labelled fact rather than a link. When present
 * it has ALREADY been through `toSafeHref`; an unsafe one arrives as null.
 *
 * `text` is plain rather than rich for the reason `CallToAction` gives — a card that links
 * should have one destination, and a second link inside the blurb competes with the title.
 */
export type Card = {
  title: string
  text: string | null
  href: string | null
}

/**
 * A grid of short, parallel items — programs, departments, quick links.
 *
 * TEXT-ONLY IN BATCH 1. The image field arrives with `media` in Phase 6 (`03` §3.1); an
 * interim external-URL image would bypass alt-required-at-upload (rule 7).
 */
export type CardGridBlock = BlockBase & {
  kind: 'cardGrid'
  heading: string | null
  cards: Card[]
}

/**
 * A third-party video (`03` §3.1, `07` §6).
 *
 * IT CARRIES NO URL AN EDITOR TYPED. `src` and `href` are both built by
 * `src/lib/embed-url.ts` from constants — the allowlist applies to what is rendered, not to
 * what was pasted (`02` §7). A row whose URL is not an allowlisted video never becomes one of
 * these; the mapper drops it.
 *
 * `title` is required rather than nullable, unlike every other block's heading. It is the
 * frame's accessible name (WCAG 4.1.2): without it the embed is announced as "frame" and
 * nothing else, so an untitled one is dropped rather than rendered.
 */
export type EmbedBlock = BlockBase & {
  kind: 'embed'
  /** The frame source, on the no-cookie host. */
  src: string
  /** The visible fallback link's destination — the watch page (`07` §6). */
  href: string
  title: string
}

/**
 * A thematic break. Carries no content and therefore no field — which is why the mapper
 * cannot drop one for being empty, and why it is the only block that always survives.
 */
export type DividerBlock = BlockBase & {
  kind: 'divider'
}

/**
 * A menu of the pages beneath this one (`03` §3.1).
 *
 * IT HAS NO LIST FIELD, AND MUST NOT GAIN ONE. The pages come from `Page.children` and are
 * threaded through `BlockList` as a prop; putting them here would mean the mapper in
 * `src/content/blocks.ts` needed page context and could no longer be a pure function over
 * JSON — which is what lets the Phase 9 migration mappers reuse it offline (`10` §5).
 *
 * It also has no ordering or depth field. The order is the resolver's (by title) and the depth
 * is one level, so there is no choice for an editor to get wrong and no way to author a menu
 * that disagrees with the site's actual structure.
 */
export type ChildPageNavBlock = BlockBase & {
  kind: 'childPageNav'
  heading: string | null
}

/**
 * A news feed AS STORED (Jason, 2026-10-28): which boards, narrowed by which tags, how many.
 * Settings only. The announcements are loaded by the resolve pass into `ResolvedFeedBlock` —
 * a block never fetches (CLAUDE.md rule 1, `03` §3.2).
 */
export type FeedBlock = BlockBase & {
  kind: 'feed'
  heading: string | null
  /** Board ids — at least one; a feed with none is dropped by the mapper. */
  boards: string[]
  /** Tag ids; any of them matches. Empty: no tag filter. */
  tags: string[]
  /** 1-10. */
  limit: number
}

/** A news feed READY TO RENDER: what `resolvePageBlocks` turns a `FeedBlock` into. */
export type ResolvedFeedBlock = BlockBase & {
  kind: 'feed'
  heading: string | null
  items: NewsItem[]
  /** The site's full announcement list, for "More news". */
  moreHref: string
}

/**
 * A calendar on a page (Jason, 2026-11-11) — Finalsite's calendar element. Settings only; the
 * events are loaded by the resolve pass into `ResolvedCalendarBlock`, as a feed's announcements
 * are. Its calendars may be any site's: the district chooses them, as a feed's boards.
 */
export type CalendarDisplay = 'list' | 'grid'

export type CalendarBlock = BlockBase & {
  kind: 'calendar'
  heading: string | null
  /** Calendar ids — at least one; a block with none is dropped by the mapper. */
  calendars: string[]
  display: CalendarDisplay
  /** A list's number of events, 1-50. The grid shows every event in its months. */
  limit: number
}

/** One day of a month grid: its date, and the keys of the events on it. */
export type CalendarDay = {
  date: string
  day: number
  isToday: boolean
  eventKeys: string[]
}

export type CalendarMonth = {
  /** `YYYY-MM`. */
  key: string
  /** E.g. "December 2026", in the reader's language. */
  label: string
  /** Weeks of seven days, Sunday first; a day outside the month is null. */
  weeks: (CalendarDay | null)[][]
  /** Every event touching the month, in order — what a narrow screen lists instead of the grid. */
  eventKeys: string[]
}

/** A calendar READY TO RENDER: what `resolvePageBlocks` turns a `CalendarBlock` into. */
export type ResolvedCalendarBlock = BlockBase & {
  kind: 'calendar'
  heading: string | null
  /**
   * One per calendar shown, in the block's order: its name and its `webcal:` feed on its own site
   * (Jason, 2026-11-11). Empty when none can be named.
   */
  subscribe: { name: string; href: string }[]
} & (
    | {
        display: 'list'
        /** The next events, earliest first, at most the block's number. */
        events: EventOccurrence[]
      }
    | {
        display: 'grid'
        weekdays: { short: string; long: string }[]
        /** From the current month on; the first is shown first. */
        months: CalendarMonth[]
        /** Every event in those months, once each — what the days' keys refer to. */
        events: EventOccurrence[]
      }
  )

/**
 * Two or three columns, each holding other blocks (Jason, 2026-11-04 — nesting allowed). Side by
 * side on a wide screen, stacked with their contents on a narrow one. One level deep: a column
 * holds any block but another set of columns.
 */
/**
 * A staff list (Jason, 2026-11-13): its SETTINGS — the one group or sub-group it shows. The staff
 * are loaded by the resolve pass into `ResolvedStaffListBlock`.
 */
export type StaffListBlock = BlockBase & {
  kind: 'staffList'
  heading: string | null
  group: string
  /** The most people side by side in a row (Jason, 2026-11-13): 1–4, fewer on narrow screens. */
  maxColumns: StaffListColumns
}

export type StaffListColumns = 1 | 2 | 3 | 4

/** A staff member as a page shows them: what CSI gives, and nothing the page does not need. */
export type StaffMember = {
  id: string
  name: string
  title: string | null
  email: string | null
}

/** A staff list READY TO RENDER: A–Z by last name. */
export type ResolvedStaffListBlock = BlockBase & {
  kind: 'staffList'
  heading: string | null
  maxColumns: StaffListColumns
  staff: StaffMember[]
}

/**
 * A document list (Jason, 2026-11-16): its SETTINGS — one folder of this site's library. The
 * documents are loaded by the resolve pass into `ResolvedDocumentListBlock`.
 */
export type DocumentListBlock = BlockBase & {
  kind: 'documentList'
  heading: string | null
  folder: string
}

/** A library document as a list shows it (`toDocumentItem`). */
export type DocumentItem = {
  id: string
  title: string
  /** The file itself. */
  href: string
  /** "PDF", "Word", "Excel", "PowerPoint" — or "File". */
  fileType: string
  /** "240 KB", or null when not known. */
  fileSize: string | null
  description: string | null
  /** Not checked for accessibility (`not-attested`): listed, with a note (`07` §5). */
  unchecked: boolean
}

/** A document list READY TO RENDER: the folder's documents, A–Z by title. */
export type ResolvedDocumentListBlock = BlockBase & {
  kind: 'documentList'
  heading: string | null
  documents: DocumentItem[]
  /** Who to ask for an accessible copy — the site's name, in the note. */
  contactName: string
}

/**
 * A library image, ready for a page (Jason, 2026-11-13): the hero size as `src`, every size Payload
 * made in `srcSet`, and the library's alt text — empty for a decorative image. Never re-entered on
 * a page.
 */
export type ImageAsset = {
  src: string
  width: number | null
  height: number | null
  alt: string
  srcSet: string
}

/** An image block's SETTINGS: the library file it shows, by id; the resolve pass loads it. */
export type ImageBlock = BlockBase & {
  kind: 'image'
  image: string
  caption: string | null
}

export type ResolvedImageBlock = BlockBase & {
  kind: 'image'
  image: ImageAsset
  caption: string | null
}

/**
 * A hero (Jason, 2026-11-13): an image, and — optionally — a heading, a subheading and a button.
 * "Images will not always have a heading."
 */
export type HeroBlock = BlockBase & {
  kind: 'hero'
  image: string
  heading: string | null
  subheading: string | null
  href: string | null
  linkLabel: string | null
  newTab: boolean
}

export type ResolvedHeroBlock = Omit<HeroBlock, 'image'> & { image: ImageAsset }

export type ColumnsBlock = BlockBase & {
  kind: 'columns'
  heading: string | null
  columns: { heading: string | null; blocks: PageBlock[] }[]
}

/** Columns READY TO RENDER: each column's data blocks resolved, as a page's are. */
export type ResolvedColumnsBlock = BlockBase & {
  kind: 'columns'
  heading: string | null
  columns: { heading: string | null; blocks: ResolvedPageBlock[] }[]
}

export type PageBlock =
  | RichTextPageBlock
  | CallToActionBlock
  | AccordionBlock
  | CardGridBlock
  | ChildPageNavBlock
  | EmbedBlock
  | DividerBlock
  | FeedBlock
  | CalendarBlock
  | StaffListBlock
  | DocumentListBlock
  | ImageBlock
  | HeroBlock
  | ColumnsBlock

/**
 * What `BlockList` renders: every block, with each DATA block resolved (Jason, 2026-10-28).
 *
 * A SEPARATE UNION ON PURPOSE. A stored `FeedBlock` is not a member, so a route that hands
 * `BlockList` a page's layout without `resolvePageBlocks` does not compile — the same guarantee
 * the exhaustive switch gives a block with no renderer. StaffList, DocumentList and Gallery join
 * the same way.
 */
export type ResolvedPageBlock =
  | Exclude<
      PageBlock,
      | FeedBlock
      | CalendarBlock
      | StaffListBlock
      | DocumentListBlock
      | ImageBlock
      | HeroBlock
      | ColumnsBlock
    >
  | ResolvedFeedBlock
  | ResolvedCalendarBlock
  | ResolvedStaffListBlock
  | ResolvedDocumentListBlock
  | ResolvedImageBlock
  | ResolvedHeroBlock
  | ResolvedColumnsBlock

/**
 * RICH TEXT (`07` §4.4).
 *
 * Hand-written domain nodes, deliberately NOT Lexical's editor state. The renderer consumes
 * these; `src/content/rich-text.ts` maps Lexical into them exactly once. That mapping is the
 * whole reason a CMS swap costs one file rather than every template (`02` §11, ADR-5).
 *
 * The vocabulary is the `07` §4.2 allowlist and nothing else. There is no node here for
 * alignment, color, underline or a table, because there is no way to author one — see
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

/**
 * A news post or announcement as the rendering layer sees it (`03` §2 `posts`).
 *
 * Only published, public posts become one — the content layer filters, so a renderer cannot
 * show a draft by forgetting to check (`03` §6.4).
 */
export type Post = {
  id: string
  /**
   * The tenant that OWNS the post. Differs from the site rendering it when the post is
   * syndicated there (`02` §6) — the one cross-tenant read (`03` §6.4 invariant 3).
   */
  tenantId: string
  title: string
  slug: string
  /** The editor's summary, or null. A list falls back to the body's first paragraph. */
  excerpt: string | null
  body: RichText
  /** ISO timestamp of first publication, or null for a row that predates the stamp. */
  publishedDate: string | null
  /** The board it is filed on, or null for a row that predates boards. */
  boardId: string | null
  /** The district tags ticked on it. */
  tagIds: string[]
  /**
   * Its image (Jason, 2026-11-13) — a file from its home site's library, shown at the top of the
   * announcement and as the thumbnail in news lists. Null when none is chosen.
   */
  image: ImageAsset | null
  /**
   * The hostname of its home site — where its page is (`/news/{slug}`). A site it is shared with
   * links there. Null where it is not known.
   */
  homeHostname: string | null
}

/**
 * EVENTS (`03` §2; Jason, 2026-11-11 — the fields of a Finalsite calendar event).
 *
 * A calendar event as the rendering layer sees it. Only published events become one — the
 * content layer filters, so a renderer cannot show a draft by forgetting to check (`03` §6.4).
 * When it happens is `timing`, which `src/lib/recurrence.ts` turns into occurrences.
 */
export type CalendarEvent = {
  id: string
  /** The site that owns it. A calendar block may show another site's calendar. */
  tenantId: string
  /** The one calendar it is on (Jason, 2026-10-28). */
  calendarId: string
  title: string
  location: string | null
  /** Shown when the event is clicked (Jason, 2026-11-11). Empty when there are none. */
  notes: RichText
  timing: EventTiming
}

/**
 * One time an event happens, ready to render: an event that repeats weekly is many of these.
 * Everything decided — dates and times already written out in the reader's language.
 */
export type EventOccurrence = {
  /** Unique within a calendar block: the event id and the local date it starts on. */
  key: string
  eventId: string
  title: string
  location: string | null
  notes: RichText
  allDay: boolean
  /** ISO instant (timed) or `YYYY-MM-DD` (all day) — for `<time dateTime>`. */
  start: string
  end: string | null
  /** Local dates, for placing it on a month grid. */
  startDate: string
  endDate: string
  /** E.g. "Friday, December 4, 2026"; for several whole days, the run of them. */
  dateLabel: string
  /** E.g. "6:00 – 8:00 PM", "All day", "Dec 1, 9:00 AM – Dec 3, 3:00 PM". Null for several whole days. */
  timeLabel: string | null
}

/**
 * An alert banner as the public site shows it (Jason, 2026-11-12) — `getAlerts` has already
 * decided it belongs on this page now. `version` changes when the alert is edited, so a banner a
 * visitor closed comes back if its words change.
 */
export type SiteAlert = {
  id: string
  severity: 'info' | 'warning' | 'emergency'
  text: string
  link: { href: string; label: string } | null
  dismissible: boolean
  version: string
}

/** The page an alert is being placed on, or null for a screen that is not a page. */
export type AlertPageRef = { id: string; isHome: boolean } | null

/**
 * SITE SEARCH (Jason, 2026-11-16; Phase 6 D) — a result as the search page shows it. Only public,
 * published content becomes one; the content layer decides, so a page cannot show a draft.
 */
export type SearchScope = 'site' | 'all'

export type SearchResult = {
  /** Unique in the results: the kind and the document's id. */
  id: string
  kind: 'page' | 'post' | 'event' | 'document'
  title: string
  /** Where it is. Null for an event whose calendar no page shows. */
  href: string | null
  /** The site it belongs to, when that is not the site searched from. */
  siteName: string | null
  /** A few words around the match, the matched words marked. */
  snippet: { text: string; match: boolean }[]
  /** An event's next time (or its last, if it is past) and place. */
  event: { when: string; location: string | null } | null
  /** A document's type and size, e.g. "PDF, 240 KB". */
  file: string | null
}

export type SearchResults = {
  query: string | null
  scope: SearchScope
  total: number
  page: number
  pageCount: number
  results: SearchResult[]
}
