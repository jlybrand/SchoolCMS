'use client'

import { createClientFeature } from '@payloadcms/richtext-lexical/client'

import { HTML_SOURCE_TITLE } from './HtmlSourceDialog'
import { HtmlSourcePlugin, OPEN_HTML_SOURCE_COMMAND } from './HtmlSourcePlugin'

/** `</>` — decorative; the button is named in words (`A11yPatch`, `TOOLBAR_NAMES`). */
const CodeIcon = () => (
  <svg aria-hidden="true" fill="none" focusable="false" height="20" viewBox="0 0 20 20" width="20">
    <path
      d="M7 6 3 10l4 4M13 6l4 4-4 4"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
)

/**
 * The client half of `HtmlSourceFeature` (`src/lib/editor.ts`), resolved through the admin import
 * map — regenerate and commit it (`pnpm run generate:importmap`).
 *
 * A group of its own, ordered just after "add" (10; the text styles are 25), so the button sits
 * after "Insert an image" and "Insert a line". In the "add" group itself it could not: Payload
 * sorts items WITH an `order` before those without, and those two have none.
 */
export const HtmlSourceFeatureClient = createClientFeature({
  plugins: [{ Component: HtmlSourcePlugin, position: 'normal' }],
  toolbarFixed: {
    groups: [
      {
        type: 'buttons',
        key: 'code',
        order: 11,
        items: [
          {
            ChildComponent: CodeIcon,
            key: 'htmlSource',
            label: HTML_SOURCE_TITLE,
            onSelect: ({ editor }) => editor.dispatchCommand(OPEN_HTML_SOURCE_COMMAND, undefined),
          },
        ],
      },
    ],
  },
})
