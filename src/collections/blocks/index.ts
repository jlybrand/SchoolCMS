import type { Block } from 'payload'

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
 * WHAT NO BLOCK HERE HAS: a heading level, a nesting slot, or a styling field. See
 * `src/content/types.ts` for why each absence is load-bearing rather than pending.
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
 * `href` is a plain text field rather than a relationship because a call to action points at
 * enrollment portals and district forms as often as at pages here, and a picker that cannot
 * express half the real destinations pushes editors into a workaround. The cost is that a
 * page rename can strand one — which `redirects` (`03` §2) is what covers.
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
    {
      name: 'href',
      type: 'text',
      required: true,
      label: 'Goes to',
      admin: { description: 'A path on this site, like /enroll, or a full web address.' },
    },
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
        {
          name: 'href',
          type: 'text',
          label: 'Goes to',
          admin: {
            description:
              'Optional. A path like /athletics, or a full web address. The title becomes the link.',
          },
        },
      ],
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
 * The library, in the order it is offered to an editor. Prose first — it is what most
 * sections are — then the block that interrupts prose to ask for something.
 */
export const blockLibrary: Block[] = [
  richTextBlock,
  accordionBlock,
  cardGridBlock,
  callToActionBlock,
  dividerBlock,
]
