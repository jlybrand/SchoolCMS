import type { Block } from 'payload'

import { schoolPalette } from '@/access/school-layout'
import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

import { toEmbedTarget } from '@/lib/embed-url'
import { linkFields } from '@/collections/fields/link'

/**
 * THE PAYLOAD SIDE of the block library (`03` §3).
 *
 * These are schema declarations. Their renderers live in `src/blocks/`, which may not import
 * the Payload SDK (CLAUDE.md rule 1) — so the two halves of a block are deliberately in
 * different directories, joined only by the mapper in `src/content/blocks.ts`. A block's
 * `slug` here is the `blockType` that mapper switches on; changing one without the other
 * silently stops rendering the block, which is what `tests/unit/blocks.test.ts` pins.
 *
 * Per CLAUDE.md's TDD exception table these declarations are not test-first — asserting
 * "this field exists" restates the schema. The behaviour is in the mapper and the renderers,
 * and both are.
 *
 * WHAT NO BLOCK HERE HAS: a heading level or a styling field. See `src/content/types.ts` for why
 * each absence is load-bearing rather than pending. Nesting arrived with `columnsBlock` (Jason,
 * 2026-11-04), one level deep, with levels still worked out rather than chosen.
 */

/**
 * Prose. Uses the global constrained editor (`07` §4.4) — no per-field override, so the
 * allowlist cannot be widened here without widening it everywhere, visibly.
 */
export const richTextBlock: Block = {
  slug: 'richText',
  interfaceName: 'RichTextBlock',
  labels: { singular: 'Text', plural: 'Text' },
  fields: [
    {
      name: 'content',
      type: 'richText',
      required: true,
      label: 'Words',
      admin: { description: 'Paragraphs, headings and lists.' },
    },
  ],
}

/**
 * One decision, presented once.
 *
 * A PAGE OR AN ADDRESS (Jason, 2026-10-29). A call to action points at enrollment portals and
 * district forms as often as at pages here, so a page picker alone would push editors into a
 * workaround — and a typed path alone is stranded by a page rename. A link to a page stores the
 * page and follows it (`src/collections/fields/link.ts`).
 */
export const callToActionBlock: Block = {
  slug: 'callToAction',
  interfaceName: 'CallToActionBlock',
  labels: { singular: 'Call to action', plural: 'Calls to action' },
  fields: [
    {
      name: 'heading',
      type: 'text',
      required: true,
      label: 'Heading',
      admin: { description: 'What this is asking the reader to do.' },
    },
    {
      name: 'text',
      type: 'textarea',
      label: 'Supporting line',
      admin: { description: 'Optional. One or two sentences of context.' },
    },
    ...linkFields({
      owner: 'pages',
      hrefDescription: 'A path on this site, like /enroll, or a full web address.',
    }),
    {
      name: 'linkLabel',
      type: 'text',
      required: true,
      label: 'Button words',
      admin: {
        description:
          'What the button says. Describe the destination — "Start enrollment", never "Click here" (WCAG 2.4.4).',
      },
    },
    {
      name: 'newTab',
      type: 'checkbox',
      defaultValue: false,
      label: 'Open in a new tab',
      admin: {
        description:
          'The button says so out loud when this is on, so people using a screen reader are not moved without warning.',
      },
    },
  ],
}

/**
 * Stacked disclosures — the FAQ shape.
 *
 * `heading` on an item is text, not rich text: it renders inside a `<summary>`, and a link
 * there would be a second interactive target competing with the disclosure control itself.
 */
export const accordionBlock: Block = {
  slug: 'accordion',
  interfaceName: 'AccordionBlock',
  labels: { singular: 'Questions and answers', plural: 'Questions and answers' },
  fields: [
    {
      name: 'heading',
      type: 'text',
      label: 'Heading',
      admin: { description: 'Optional. A title for the whole set, like "Common questions".' },
    },
    {
      name: 'items',
      type: 'array',
      required: true,
      minRows: 1,
      label: 'Questions',
      labels: { singular: 'Question', plural: 'Questions' },
      fields: [
        { name: 'heading', type: 'text', required: true, label: 'Question' },
        { name: 'content', type: 'richText', required: true, label: 'Answer' },
      ],
    },
  ],
}

/**
 * Short, parallel items — programs, departments, quick links.
 *
 * TEXT-ONLY. The image field arrives with `media` in Phase 6 (`03` §3.1); an interim
 * external-URL image would bypass alt-required-at-upload (rule 7).
 */
export const cardGridBlock: Block = {
  slug: 'cardGrid',
  interfaceName: 'CardGridBlock',
  labels: { singular: 'Cards', plural: 'Cards' },
  fields: [
    {
      name: 'heading',
      type: 'text',
      label: 'Heading',
      admin: { description: 'Optional. A title for the whole set.' },
    },
    {
      name: 'cards',
      type: 'array',
      required: true,
      minRows: 1,
      label: 'Cards',
      labels: { singular: 'Card', plural: 'Cards' },
      fields: [
        { name: 'title', type: 'text', required: true, label: 'Title' },
        { name: 'text', type: 'textarea', label: 'Description' },
        // Optional: "Nothing" is the default. The title becomes the link.
        ...linkFields({
          owner: 'pages',
          optional: true,
          hrefDescription:
            'A path like /athletics, or a full web address. The title becomes the link.',
        }),
      ],
    },
  ],
}

/**
 * A menu of the pages beneath this one.
 *
 * ONE FIELD, AND THAT ONE OPTIONAL. The list itself is the page's own children, resolved at
 * render (`src/content/pages.ts`) — so there is nothing here to keep in step with the site's
 * structure, and no way to author a menu that disagrees with it. Adding a page beneath this
 * one puts it in the menu; unpublishing it takes it out.
 *
 * NO ORDERING FIELD AND NO DEPTH FIELD. The order is alphabetical and the depth is one level.
 * Both are decisions the platform makes so a school manager does not have to (`04` §2.1), and
 * both are cheap to revisit — a manual order needs a sort field on `pages`, which is an
 * authoring-model decision rather than a block one.
 */
export const childPageNavBlock: Block = {
  slug: 'childPageNav',
  interfaceName: 'ChildPageNavBlock',
  labels: { singular: 'Pages in this section', plural: 'Pages in this section' },
  fields: [
    {
      name: 'heading',
      type: 'text',
      label: 'Heading',
      admin: {
        /**
         * The description carries what the block does, because the block has no other field
         * and would otherwise look broken in the admin — empty here, a list of links on the
         * site. Said out loud rather than left to be inferred (`04` §2.1).
         */
        description:
          'Optional. A title for the menu, like "In this section" — it also names the menu for screen readers. The menu itself lists every page saved underneath this one, in alphabetical order, and keeps itself up to date.',
      },
    },
  ],
}

/**
 * A third-party video (`07` §6).
 *
 * THE ALLOWLIST IS ENFORCED TWICE, and the two layers answer different questions:
 *
 *   - **here**, so an editor pasting the wrong thing is told at once rather than publishing a
 *     block that silently vanishes;
 *   - **in `src/content/blocks.ts`**, which is the gate that actually holds — it also covers
 *     rows written by a migration or a direct database write, which never reach this validator.
 *
 * Both call the same normalizer, so there is one definition of what is allowed
 * (`src/lib/embed-url.ts`). YouTube only, decided 2026-08-28: `07` §6 requires a current
 * VPAT/ACR from any embedded vendor before allowlisting, which makes adding a host a
 * procurement step rather than a code change (`03` §3.3).
 */
export const embedBlock: Block = {
  slug: 'embed',
  interfaceName: 'EmbedBlock',
  labels: { singular: 'Video', plural: 'Videos' },
  fields: [
    {
      name: 'url',
      type: 'text',
      required: true,
      label: 'YouTube link',
      admin: {
        description:
          'Paste the link from YouTube — the address bar, the Share button, or the embed code all work.',
      },
      validate: (value: unknown) => {
        if (typeof value !== 'string' || value.trim() === '') {
          return 'Paste a YouTube link.'
        }
        return toEmbedTarget(value) === null
          ? 'That is not a YouTube link the district has approved. Only YouTube videos can be added at the moment.'
          : true
      },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'What the video is',
      admin: {
        /**
         * Required, and said out loud: this is the frame's accessible name (WCAG 4.1.2), not a
         * caption. `07` §6 requires one on every embed.
         */
        description:
          'Describe the video in a few words, like "Board meeting, 12 August". People using a screen reader hear this instead of seeing the video, and it is shown as the link below it.',
      },
    },
  ],
}

/**
 * A thematic break. No fields — it carries no content, which is also why the mapper can never
 * drop one for being empty.
 */
export const dividerBlock: Block = {
  slug: 'divider',
  interfaceName: 'DividerBlock',
  labels: { singular: 'Divider', plural: 'Dividers' },
  fields: [],
}

/**
 * A news feed (Jason, 2026-10-28) — Finalsite's post element. Stores a QUERY: which boards,
 * narrowed by which tags, how many. The announcements are loaded at render by the resolve pass
 * (`src/content/resolve-blocks.ts`); who can see each one is still its own sharing, so a board
 * from another site shows only what is shared with this one.
 *
 * Boards from ANY site may be picked — that is how SHS's homepage shows District News. Both
 * pickers are not sortable: order means nothing, and a sortable chip nests buttons (axe).
 */
export const feedBlock: Block = {
  slug: 'feed',
  interfaceName: 'FeedBlockRow',
  labels: { singular: 'News feed', plural: 'News feeds' },
  fields: [
    {
      name: 'heading',
      type: 'text',
      label: 'Heading',
      admin: {
        description:
          'Optional. A title above the announcements, like "District news" — it also names this part of the page for screen readers.',
      },
    },
    {
      name: 'boards',
      type: 'relationship',
      relationTo: 'post-boards',
      hasMany: true,
      required: true,
      label: 'Boards',
      // Other sites' boards too — see src/lib/cross-tenant-relationships.ts.
      custom: { crossTenant: true },
      admin: {
        isSortable: false,
        description:
          'Which boards to show announcements from. Another site’s board shows only the announcements shared with this site.',
      },
    },
    {
      name: 'tags',
      type: 'relationship',
      relationTo: 'post-tags',
      hasMany: true,
      label: 'Only these tags',
      admin: {
        isSortable: false,
        description: 'Optional. Show only announcements with any of these tags.',
      },
    },
    {
      name: 'limit',
      type: 'number',
      label: 'How many',
      min: 1,
      max: 10,
      defaultValue: 5,
      admin: {
        description:
          'Up to 10 of the newest. "More news" links to the rest. With none to show, this part of the page is hidden.',
      },
    },
  ],
}

/**
 * The library, in the order it is offered to an editor. Prose first — it is what most
 * sections are — then the block that interrupts prose to ask for something.
 */
/**
 * Columns (Jason, 2026-11-04): two or three, each holding other blocks — any block in the library
 * but another set of columns, so nesting is one level deep. Side by side on a wide screen,
 * stacked with their contents on a narrow one (`src/blocks/Columns/`). Heading levels inside are
 * worked out from where each sits (`columnLevels`), so none is asked for here either. A nested
 * block is stored in the same `pages_blocks_*` table as a top-level one, told apart by its path.
 */
export const columnsBlock: Block = {
  slug: 'columns',
  interfaceName: 'ColumnsBlock',
  labels: { singular: 'Columns', plural: 'Columns' },
  fields: [
    {
      name: 'heading',
      type: 'text',
      label: 'Heading',
      admin: { description: 'Optional. A title over all the columns.' },
    },
    {
      name: 'columns',
      type: 'array',
      required: true,
      minRows: 2,
      maxRows: 3,
      label: 'Columns',
      labels: { singular: 'Column', plural: 'Columns' },
      admin: {
        description: 'Two or three. They sit side by side on a wide screen and stack on a phone.',
      },
      fields: [
        {
          name: 'heading',
          type: 'text',
          label: 'Column heading',
          admin: { description: 'Optional.' },
        },
        {
          name: 'content',
          type: 'blocks',
          label: 'In this column',
          labels: { singular: 'Section', plural: 'Sections' },
          // As on the page: a school's picker offers the simple components (`schoolPalette`).
          filterOptions: ({ siblingData, user }) =>
            sendsForApproval(user as AuthUser | null)
              ? schoolPalette((siblingData as { content?: unknown } | undefined)?.content)
              : true,
          blocks: [
            richTextBlock,
            callToActionBlock,
            accordionBlock,
            cardGridBlock,
            childPageNavBlock,
            embedBlock,
            dividerBlock,
            feedBlock,
          ],
        },
      ],
    },
  ],
}

export const blockLibrary: Block[] = [
  richTextBlock,
  accordionBlock,
  cardGridBlock,
  callToActionBlock,
  childPageNavBlock,
  feedBlock,
  embedBlock,
  dividerBlock,
  columnsBlock,
]
