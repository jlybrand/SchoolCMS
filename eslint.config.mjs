// @ts-check
import next from 'eslint-config-next'

/**
 * GUARDRAIL 1 of 2 — the content-access layer boundary (`02` §11, ADR-5).
 *
 * The frontend must never call Payload directly. It calls `src/content/*`, which returns
 * hand-written DD2 domain types. This is the single difference between a swappable and an
 * unswappable system, and it only holds if it is CI-enforced from day one rather than left
 * to code review (`06` §2.8).
 *
 * NOTE ON SCOPE. The design doc states the rule as "no file under `src/app/**` imports the
 * Payload SDK". Taken literally that is unimplementable: Payload 3 mounts its own admin UI
 * and REST/GraphQL handlers as App Router routes under `src/app/(payload)/`, and those
 * files import `@payloadcms/next` by construction. The rule is therefore enforced on the
 * *public rendering layer* — `src/app/(frontend)/`, `src/components/`, `src/blocks/` —
 * which is the surface the rule actually exists to protect. `src/app/(payload)/` is
 * Payload's own mount point, contains no DD2 rendering logic, and is exempt.
 */
const PAYLOAD_SDK = ['payload', 'payload/*', '@payloadcms/*', '@payloadcms/*/*']
const PAYLOAD_GENERATED_TYPES = ['**/payload-types', '**/payload-types.js', '@/payload-types']

const boundaryMessage =
  'The public rendering layer must not import the Payload SDK. Call a function from ' +
  'src/content/* instead, which returns DD2 domain types (02 §11, ADR-5).'

const generatedTypesMessage =
  "Do not consume Payload's generated types outside the content layer. Use the " +
  'hand-written DD2 domain types in src/content/types.ts (02 §11).'

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      '.lighthouseci/**',
      'src/payload-types.ts',
      'src/app/(payload)/admin/importMap.js',
      'next-env.d.ts',
    ],
  },

  ...next,

  // ---------------------------------------------------------------------------
  // GUARDRAIL 1 — the swap hedge. Failing this is a CI failure, not a nit.
  // ---------------------------------------------------------------------------
  {
    files: [
      'src/app/(frontend)/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/blocks/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: PAYLOAD_SDK, message: boundaryMessage },
            { group: PAYLOAD_GENERATED_TYPES, message: generatedTypesMessage },
          ],
        },
      ],
    },
  },

  // The content layer is the one place allowed to hold both sides of the mapping.
  // It may import the SDK; it may NOT re-export Payload's generated types outward.
  {
    files: ['src/content/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // ---------------------------------------------------------------------------
  // Accessibility lint. jsx-a11y ships with eslint-config-next; these are the rules
  // that back the structural conformance claims in `07` §3, raised to errors.
  // ---------------------------------------------------------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/heading-has-content': 'error',
      'jsx-a11y/iframe-has-title': 'error',
      'jsx-a11y/img-redundant-alt': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-redundant-roles': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
    },
  },

  {
    files: ['tests/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
]

export default config
