'use client'

import { createClientFeature } from '@payloadcms/richtext-lexical/client'

import { PasteNormalizerPlugin } from './PasteNormalizerPlugin'

/**
 * The client half of `PasteNormalizerFeature` (`src/lib/editor.ts`).
 *
 * Resolved by the path in that file through the admin import map, which is generated and
 * COMMITTED — `pnpm run generate:importmap`. A stale import map builds fine and then fails at
 * runtime, when the admin cannot resolve a component it was told exists; CI asserts the
 * committed copy matches the config.
 *
 * `position: 'normal'` because this plugin renders no editor chrome. It registers a command
 * and owns a dialog, and needs to be inside the Lexical composer to do either.
 */
export const PasteNormalizerFeatureClient = createClientFeature({
  plugins: [{ Component: PasteNormalizerPlugin, position: 'normal' }],
})
