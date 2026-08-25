import {
  BoldFeature,
  FixedToolbarFeature,
  HeadingFeature,
  ItalicFeature,
  LinkFeature,
  OrderedListFeature,
  ParagraphFeature,
  UnorderedListFeature,
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
 * structured and is not — centred text, colour used to carry meaning, a bold line standing
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
 * Feature keys DD2 wrote, as opposed to ones Payload ships.
 *
 * `TRIAGED_FEATURES` answers "what did Payload ship that nobody has decided about yet", so a
 * feature we wrote does not belong in it — it would be us answering our own question, and it
 * would break the exported-names assertion that makes the triage table an upgrade guard at
 * all. `tests/unit/editor.test.ts` reads this list instead, and asserts no key here collides
 * with a Payload one.
 */
export const DD2_FEATURE_KEYS: readonly string[] = ['pasteNormalizer']

/** The features the editor enables. Everything else in the package is denied below. */
export const CONSTRAINED_FEATURES = [
  ParagraphFeature(),
  /**
   * h2 and h3 only. `h1` is the page title, rendered by the template through
   * `PAGE_TITLE_LEVEL` — a body `h1` would give the page two, which is a heading-order
   * violation an editor could produce by accident (`03` §3, `07` §3).
   */
  HeadingFeature({ enabledHeadingSizes: ['h2', 'h3'] }),
  BoldFeature(),
  ItalicFeature(),
  LinkFeature(),
  UnorderedListFeature(),
  OrderedListFeature(),
  /**
   * Presentation only — it renders the controls for the features above and adds no content
   * capability of its own. Fixed rather than floating because the usability bar is a school
   * manager who last logged in five months ago and read no documentation: the controls have
   * to be visible, not discovered.
   */
  FixedToolbarFeature(),
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
]

export type FeatureVerdict = { allowed: true; key: string } | { allowed: false; reason: string }

/**
 * Every Lexical feature the package exports, with a verdict.
 *
 * Keep this in sync deliberately, never mechanically: the test failing after a Payload bump
 * is the point. A new entry should be added by someone who has decided what the feature
 * would let an author do, not by someone making a red test green.
 */
export const TRIAGED_FEATURES: Record<string, FeatureVerdict> = {
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
  AlignFeature: {
    allowed: false,
    reason:
      'Alignment is a design decision the theme owns. Centred body text also harms readability for dyslexic readers, and `08` §6 needs alignment to follow writing direction rather than an author’s choice.',
  },
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
  TextStateFeature: {
    allowed: false,
    reason:
      'Arbitrary colour and styling defeats the token-level contrast guarantee (`07` §3) — the palette is validated, ad-hoc colours are not.',
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
  BlockquoteFeature: {
    allowed: false,
    reason:
      'Not in the `07` §4.2 allowlist. Commonly misused for visual emphasis rather than quotation, which is exactly the appearance-as-structure problem.',
  },
  HorizontalRuleFeature: {
    allowed: false,
    reason:
      'A decorative separator carrying no semantics. Sections are separated by headings, which are navigable.',
  },
  ChecklistFeature: {
    allowed: false,
    reason:
      'Interactive-looking content that is not interactive. A reader cannot tick it, and its state means nothing.',
  },

  // ---- Denied: belongs to another, governed flow --------------------------
  UploadFeature: {
    allowed: false,
    reason:
      'Images go through the media flow so alt text is captured at upload (`07` §4.3). An inline upload path would bypass that enforcement.',
  },
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
