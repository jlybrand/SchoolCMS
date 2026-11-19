import {
  AlignFeature,
  BlockquoteFeature,
  BoldFeature,
  FixedToolbarFeature,
  HeadingFeature,
  HorizontalRuleFeature,
  ItalicFeature,
  LinkFeature,
  OrderedListFeature,
  ParagraphFeature,
  UnorderedListFeature,
  TextStateFeature,
  UploadFeature,
  createServerFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical'

/**
 * CONSTRAINED RICH TEXT (`07` §4.4).
 *
 * ============================================================================
 * An editor cannot express a formatting idea the design system has not already
 * made accessible. This is a conformance control, not a preference.
 * ============================================================================
 *
 * `07` §4.4 says to explain this to communications staff as a feature, and it is one: the
 * removed controls are the ones that let a well-meaning author produce content that looks
 * structured and is not — centred text, color used to carry meaning, a bold line standing
 * in for a heading. What remains maps exactly onto the elements the paste normalizer admits
 * (`07` §4.2), so typing and pasting produce the same vocabulary.
 *
 * WHY THE TRIAGE TABLE BELOW EXISTS. The risk to this control is not someone deliberately
 * widening it — it is a Payload upgrade shipping a new feature that nobody notices, since
 * `09` §2 makes version bumps their own PR and a bump does not read as a policy change.
 * `tests/unit/editor.test.ts` fails until every exported feature appears here with a
 * verdict, which turns "a new capability appeared" into a decision someone has to make.
 */

/**
 * THE PASTE NORMALIZER, wired into the editor (`07` §4.2).
 *
 * DD2's own feature, not Payload's — the only entry in `CONSTRAINED_FEATURES` that is not a
 * package export, and the reason `DD2_FEATURE_KEYS` exists below.
 *
 * It is in a list otherwise chosen for what an author may EXPRESS because it is the same
 * control at the other end: the allowlist decides what can be typed, this decides what
 * survives being pasted. `src/lib/paste-normalizer.ts` does the work and has since PR #6;
 * this is the wiring, and the client half is where the prompt lives.
 *
 * `ClientFeature` is a path resolved through the admin import map, whose `baseDir` is `src/`
 * (`src/payload.config.ts`). It must be regenerated and committed — `pnpm run
 * generate:importmap` — or the admin fails at RUNTIME rather than at build, because a
 * component it was told exists cannot be resolved. CI asserts the committed copy matches.
 */
export const PasteNormalizerFeature = createServerFeature({
  feature: {
    ClientFeature: '/admin/PasteNormalizer/feature.client#PasteNormalizerFeatureClient',
  },
  key: 'pasteNormalizer',
})

/**
 * THE TEXT AS HTML (Jason, 2026-11-19: "select <> and the contents of the text editor are shown
 * in HTML5"; earlier that day, HTML "checked before hand"), for schools and the district alike.
 *
 * DD2's own feature, and the same control as the paste normalizer: HTML is never stored as
 * written. `src/lib/html-source.ts` writes the text as HTML5 and reads the edited code back over
 * exactly the vocabulary below, NAMING everything it took out (frames, scripts, form fields,
 * styling…) before the text changes. Embeds are not here: they are sections of their own.
 */
export const HtmlSourceFeature = createServerFeature({
  feature: {
    ClientFeature: '/admin/HtmlSource/feature.client#HtmlSourceFeatureClient',
  },
  key: 'htmlSource',
})

/**
 * Feature keys DD2 wrote, as opposed to ones Payload ships.
 *
 * `TRIAGED_FEATURES` answers "what did Payload ship that nobody has decided about yet", so a
 * feature we wrote does not belong in it — it would be us answering our own question, and it
 * would break the exported-names assertion that makes the triage table an upgrade guard at
 * all. `tests/unit/editor.test.ts` reads this list instead, and asserts no key here collides
 * with a Payload one.
 */
export const DD2_FEATURE_KEYS: readonly string[] = ['pasteNormalizer', 'htmlSource']

/** The features the editor enables. Everything else in the package is denied below. */
export const CONSTRAINED_FEATURES = [
  ParagraphFeature(),
  /**
   * h2 to h4 — Heading, Subheading, Minor heading (the third, Jason 2026-11-19: "sometimes it is
   * helpful to resize headers" — a smaller heading that is still a heading, so the outline stays
   * true). `h1` is the page title, rendered by the template through `PAGE_TITLE_LEVEL` — a body
   * `h1` would give the page two, which is a heading-order violation an editor could produce by
   * accident (`03` §3, `07` §3).
   */
  HeadingFeature({ enabledHeadingSizes: ['h2', 'h3', 'h4'] }),
  /**
   * ONE text style, "Large text" (Jason, 2026-11-19), for an introduction — a preset size from
   * the design, never a free one or a color, so the contrast and legibility guarantees hold
   * (`07` §3). The page renders it from `src/components/RichText` (`--font-size-lg`); the css
   * here is only the editor's preview of it.
   */
  TextStateFeature({
    state: { size: { large: { label: 'Large text', css: { 'font-size': '1.25em' } } } },
  }),
  BoldFeature(),
  ItalicFeature(),
  /**
   * Internal links go to PAGES only (Jason, 2026-10-29): a page is the only thing here with a
   * public address, and `src/content/rich-text.ts` resolves the stored page to its path today,
   * so a rename or a move never breaks the link. `maxDepth: 0` stores the page's id, not a copy
   * of the whole page inside the words.
   */
  LinkFeature({
    enabledCollections: ['pages'],
    maxDepth: 0,
    /**
     * A link's own screen-reader words (Jason, 2026-11-19: aria-labels kept "unless they are
     * unnecessary"). The page renders them only when they add to the link's words and contain
     * them — WCAG 2.5.3 (`linkLabelVerdict`, applied in `src/content/rich-text.ts`).
     */
    fields: ({ defaultFields }) => [
      ...defaultFields,
      {
        name: 'ariaLabel',
        type: 'text',
        label: 'Words for screen readers',
        admin: {
          description:
            'Only when the link’s words need more, and include them: “Read more about the bond election” for a link that says “Read more”.',
        },
      },
    ],
  }),
  UnorderedListFeature(),
  OrderedListFeature(),
  /**
   * ADDED BY JASON'S DECISION, 2026-11-19 ("a more robust text editor"), for schools and the
   * district alike. Each was denied before; the triage table below records why it is allowed now
   * and what keeps it safe.
   *
   * Alignment: rendered as center or END only (`src/content/rich-text.ts`) — a translated page
   * mirrors (`08` §6) and justify is never rendered (WCAG 1.4.8). An exception to `07` §4.4.
   */
  AlignFeature(),
  /** A real quotation, `<blockquote>`. */
  BlockquoteFeature(),
  /** A line, `<hr>` — a thematic break, as the Divider section between sections. */
  HorizontalRuleFeature(),
  /**
   * Images from the site's LIBRARY only (`resources`), where alt text is required at upload or a
   * file is marked decorative (CLAUDE.md rule 7) — the governed flow `07` §4.3 asks for, now
   * reachable from the text. No per-image fields: the alt text is the library's. Stored by id
   * (`maxDepth: 0`); the content layer fills the image in (`fillRichTextImages`).
   */
  UploadFeature({
    enabledCollections: ['resources'],
    maxDepth: 0,
    /**
     * Each image's size and place (Jason, 2026-11-19: "can the image that is inserted be
     * resized?") — presets, so it reads on a phone: on a narrow screen every image is full width
     * on its own line. Left and right are START and END when stored, so a translation mirrors.
     */
    collections: {
      resources: {
        fields: [
          {
            name: 'size',
            type: 'radio',
            label: 'Size',
            defaultValue: 'full',
            options: [
              { label: 'Small', value: 'small' },
              { label: 'Medium', value: 'medium' },
              { label: 'Full width', value: 'full' },
            ],
          },
          {
            name: 'position',
            type: 'radio',
            label: 'Place',
            defaultValue: 'block',
            options: [
              { label: 'On its own line', value: 'block' },
              { label: 'Left of the text, which wraps round it', value: 'start' },
              { label: 'Right of the text, which wraps round it', value: 'end' },
            ],
          },
        ],
      },
    },
  }),
  /**
   * Presentation only — it renders the controls for the features above and adds no content
   * capability of its own. Fixed rather than floating because the usability bar is a school
   * manager who last logged in five months ago and read no documentation: the controls have
   * to be visible, not discovered.
   */
  FixedToolbarFeature({
    /**
     * A BETTER TOOLBAR (Jason, 2026-11-19): the text styles and the things to insert as buttons
     * in plain sight, not in menus — a school manager who logs in twice a year sees every choice.
     * Alignment stays a menu. Each control is named in words by `A11yPatch` (`TOOLBAR_NAMES`).
     */
    customGroups: { text: { type: 'buttons' }, add: { type: 'buttons' } },
  }),
  /** After the features whose nodes its HTML becomes, as the paste normalizer is. */
  HtmlSourceFeature(),
  /**
   * Last, so its `PASTE_COMMAND` handler registers after the features whose nodes it
   * produces. It contributes no toolbar control and no node type of its own.
   */
  PasteNormalizerFeature(),
]

export const CONSTRAINED_FEATURE_KEYS: readonly string[] = CONSTRAINED_FEATURES.map((f) => f.key)

/**
 * The HTML elements this feature set can produce.
 *
 * Kept beside the config rather than derived, because Payload does not expose a
 * feature-to-element mapping and inferring one would be guesswork. The test asserts it
 * against `ALLOWED_ELEMENTS` in the paste normalizer, so the two layers of `07` §4.2 cannot
 * drift apart silently.
 */
export const EDITOR_ELEMENTS: readonly string[] = [
  'p',
  'h2',
  'h3',
  'strong',
  'em',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
  'img',
  'h4',
  'span',
]

/**
 * Elements the editor makes that a PASTE does not keep (yet), each with why. The two allowlists
 * are otherwise the same rule (`07` §4.2); the test holds the difference to exactly this list.
 */
export const EDITOR_ONLY_ELEMENTS: Readonly<Record<string, string>> = {
  img: 'An image comes from the library, where alt text is required (rule 7). A pasted image has neither, so paste keeps refusing it.',
  span: 'The one text style, "Large text" (2026-11-19) — a size, not a meaning. Paste never brings a size in.',
}

export type FeatureVerdict = { allowed: true; key: string } | { allowed: false; reason: string }

/**
 * Every Lexical feature the package exports, with a verdict.
 *
 * Keep this in sync deliberately, never mechanically: the test failing after a Payload bump
 * is the point. A new entry should be added by someone who has decided what the feature
 * would let an author do, not by someone making a red test green.
 */
export const TRIAGED_FEATURES: Record<string, FeatureVerdict> = {
  // ---- Allowed: Jason's decision, 2026-11-19 ("a more robust text editor") --------------
  AlignFeature: { allowed: true, key: 'align' },
  BlockquoteFeature: { allowed: true, key: 'blockquote' },
  HorizontalRuleFeature: { allowed: true, key: 'horizontalRule' },
  UploadFeature: { allowed: true, key: 'upload' },
  /** One preset only, "Large text" — never a color or a free size. */
  TextStateFeature: { allowed: true, key: 'textState' },

  // ---- Allowed: the `07` §4.2 vocabulary ----------------------------------
  ParagraphFeature: { allowed: true, key: 'paragraph' },
  HeadingFeature: { allowed: true, key: 'heading' },
  BoldFeature: { allowed: true, key: 'bold' },
  ItalicFeature: { allowed: true, key: 'italic' },
  LinkFeature: { allowed: true, key: 'link' },
  UnorderedListFeature: { allowed: true, key: 'unorderedList' },
  OrderedListFeature: { allowed: true, key: 'orderedList' },
  FixedToolbarFeature: { allowed: true, key: 'toolbarFixed' },

  // ---- Denied: appearance standing in for structure -----------------------
  IndentFeature: {
    allowed: false,
    reason:
      'Indentation fakes hierarchy that no assistive technology can see. Real nesting is a list; real hierarchy is a heading.',
  },
  UnderlineFeature: {
    allowed: false,
    reason:
      'Underlined text that is not a link is a usability trap — it is the one convention users rely on to identify links.',
  },
  StrikethroughFeature: {
    allowed: false,
    reason:
      'Conveys "cancelled" or "superseded" by appearance alone, which fails WCAG 1.4.1. Say it in words instead.',
  },
  SubscriptFeature: { allowed: false, reason: 'Not in the `07` §4.2 allowlist; no DD2 use case.' },
  SuperscriptFeature: {
    allowed: false,
    reason: 'Not in the `07` §4.2 allowlist; no DD2 use case.',
  },
  InlineCodeFeature: {
    allowed: false,
    reason: 'Not in the `07` §4.2 allowlist. A school site has no code samples.',
  },
  ChecklistFeature: {
    allowed: false,
    reason:
      'Interactive-looking content that is not interactive. A reader cannot tick it, and its state means nothing.',
  },

  // ---- Denied: belongs to another, governed flow --------------------------
  RelationshipFeature: {
    allowed: false,
    reason:
      'Inline document references are a content-modelling decision, not a formatting one. Typed fields and blocks express them (`07` §4.5).',
  },
  BlocksFeature: {
    allowed: false,
    reason:
      'Blocks are the district-only `composed` page layout (`03` §3). Nesting them inside body text would put the block library behind the school-manager rich-text field and defeat the composed-page gate.',
  },
  EXPERIMENTAL_TableFeature: {
    allowed: false,
    reason:
      'Tables are rejected on paste with a plain-language alternative (`07` §4.2), so offering an editor to build one would contradict the normalizer. Accessible data tables need headers and scope that this control does not require.',
  },

  // ---- Denied: presentation or tooling, not content -----------------------
  InlineToolbarFeature: {
    allowed: false,
    reason:
      'A floating toolbar has to be discovered. The fixed toolbar is enabled instead, for the infrequent-user bar in CLAUDE.md.',
  },
  HTMLConverterFeature: {
    allowed: false,
    reason:
      'Rendering is the content layer’s job (`02` §11). Converting to HTML inside Payload would put markup generation on the wrong side of the boundary.',
  },
  DebugJsxConverterFeature: { allowed: false, reason: 'Debug tooling; not for production.' },
  TestRecorderFeature: { allowed: false, reason: 'Debug tooling; not for production.' },
  TreeViewFeature: { allowed: false, reason: 'Debug tooling; not for production.' },
}

/**
 * The editor used everywhere in this project.
 *
 * Set as the GLOBAL editor in `src/payload.config.ts` rather than per field, so a new rich
 * text field is constrained by default. A field that opted in would be a field someone could
 * forget to opt in.
 */
export const constrainedEditor = () => lexicalEditor({ features: CONSTRAINED_FEATURES })
