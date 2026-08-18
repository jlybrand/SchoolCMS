import * as lexicalPackage from '@payloadcms/richtext-lexical'
import { describe, expect, it } from 'vitest'

import {
  CONSTRAINED_FEATURES,
  CONSTRAINED_FEATURE_KEYS,
  EDITOR_ELEMENTS,
  TRIAGED_FEATURES,
} from '@/lib/editor'
import { ALLOWED_ELEMENTS } from '@/lib/paste-normalizer'

/**
 * The constrained rich-text allowlist (`07` §4.4).
 *
 * WHY THIS IS A GUARDRAIL AND NOT A CONFIG TEST. `07` §4.4 is a conformance control stated
 * as a product decision: "editors cannot express a formatting idea the design system hasn't
 * already made accessible." That only holds if the editor's capability set is enforced
 * somewhere a reviewer cannot silently widen. A comment saying "keep this minimal" decays;
 * this file fails.
 *
 * Two distinct failures are caught here:
 *
 *   1. Someone adds a feature to the editor. The exact-set assertion fails.
 *   2. **Payload adds a feature on upgrade.** The triage assertion fails — a new capability
 *      appearing in the package is a decision for a person, not a default to inherit. This
 *      is the one a config test would miss entirely, and version bumps are exactly when the
 *      surface widens without anyone choosing it (`09` §2).
 */

describe('the editor allowlist', () => {
  it('enables exactly the intended features — no more', () => {
    expect([...CONSTRAINED_FEATURE_KEYS].sort()).toEqual(
      [
        'bold',
        'heading',
        'italic',
        'link',
        'orderedList',
        'paragraph',
        'unorderedList',
        // Presentation, not a content capability: it renders the controls for the features
        // above and adds none of its own. A school manager who logs in twice a year needs
        // to SEE the controls rather than discover a floating toolbar (CLAUDE.md usability
        // bar).
        'toolbarFixed',
      ].sort(),
    )
  })

  it('the configured features match the declared keys', () => {
    // Guards against the array and the key list drifting apart, which would make every
    // other assertion in this file test the wrong thing.
    expect(CONSTRAINED_FEATURES.map((f) => f.key).sort()).toEqual(
      [...CONSTRAINED_FEATURE_KEYS].sort(),
    )
  })

  it('matches the paste normalizer’s allowlist, element for element', () => {
    /**
     * The two allowlists are the same rule in `07` §4.2 expressed at two layers — what the
     * normalizer lets THROUGH on paste, and what the editor lets an author TYPE. If they
     * diverge, one of them is wrong: an element the editor can produce but the normalizer
     * strips would vanish on the author's next paste, and an element the normalizer admits
     * but the editor cannot produce is unreachable markup in the database.
     */
    expect([...EDITOR_ELEMENTS].sort()).toEqual([...ALLOWED_ELEMENTS].sort())
  })

  it('restricts headings to h2 and h3 — h1 belongs to the page, not the body', () => {
    /**
     * Blocks own their heading levels (`03` §3, CLAUDE.md working conventions): an editor
     * must not be able to produce a heading-order violation. `h1` is the page title,
     * rendered by the template through `PAGE_TITLE_LEVEL`; a body `h1` would give the page
     * two.
     */
    const heading = CONSTRAINED_FEATURES.find((f) => f.key === 'heading')
    const sizes = (heading?.serverFeatureProps as { enabledHeadingSizes?: string[] } | undefined)
      ?.enabledHeadingSizes

    expect(sizes).toEqual(['h2', 'h3'])
  })

  it.each([
    ['align', 'text alignment is a design decision, and centred text harms readability'],
    ['indent', 'indentation fakes structure that screen readers cannot see'],
    ['underline', 'underlined text that is not a link is a usability trap'],
    ['strikethrough', 'conveys meaning by appearance alone'],
    ['textState', 'arbitrary colour and styling defeats the token-level contrast guarantee'],
    ['blockquote', 'not in the `07` §4.2 allowlist'],
    ['horizontalrule', 'decorative separators carry no semantics'],
    ['upload', 'images go through the media flow so alt text is captured (`07` §4.3)'],
  ])('does not enable %s — %s', (key) => {
    expect(CONSTRAINED_FEATURE_KEYS.map((k) => k.toLowerCase())).not.toContain(key)
  })
})

describe('feature triage', () => {
  it('every feature the package exports has been triaged', () => {
    /**
     * The upgrade guard. A Payload bump that ships a new Lexical feature fails here until
     * someone puts it in `TRIAGED_FEATURES` as allowed or denied — with a reason.
     *
     * Deliberately compared on EXPORT NAMES rather than instantiated features: several
     * require arguments, and a test that constructs them would break for reasons unrelated
     * to the thing it is guarding.
     */
    const exported = Object.keys(lexicalPackage)
      // Feature constructors are PascalCase. `createServerFeature` also ends in "Feature"
      // but is the builder used to write one, not a capability to triage.
      .filter((name) => name.endsWith('Feature') && /^[A-Z]/.test(name))
      .sort()

    const triaged = Object.keys(TRIAGED_FEATURES).sort()

    expect(exported).toEqual(triaged)
  })

  it('every feature marked allowed is actually enabled, and no denied one is', () => {
    const allowedKeys = Object.values(TRIAGED_FEATURES)
      .filter((verdict) => verdict.allowed)
      .map((verdict) => verdict.key)

    expect(allowedKeys.sort()).toEqual([...CONSTRAINED_FEATURE_KEYS].sort())
  })

  it('every denied feature carries a reason', () => {
    // A denial with no reason is indistinguishable from an oversight, and the next person
    // to read it has no basis to disagree.
    for (const [name, verdict] of Object.entries(TRIAGED_FEATURES)) {
      if (verdict.allowed) continue
      expect(verdict.reason, `${name} is denied without a reason`).toBeTruthy()
    }
  })
})
