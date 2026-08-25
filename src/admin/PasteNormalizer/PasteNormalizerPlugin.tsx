'use client'

import {
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  PASTE_COMMAND,
} from '@payloadcms/richtext-lexical/lexical'
import { $generateNodesFromDOM } from '@payloadcms/richtext-lexical/lexical/html'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { useCallback, useEffect, useState } from 'react'

import type { NormalizedPaste } from '@/lib/paste-normalizer'
import { normalizePastedHtml, promoteHeadings } from '@/lib/paste-normalizer'

import { PastePrompt } from '../PastePrompt'

/**
 * Wires the paste normalizer into the editor's paste path (`07` §4.2).
 *
 * NORMALIZATION HAPPENS ON PASTE, NOT ON RENDER. Sanitizing at render would leave the Word
 * soup in the database and re-inflict it on every future consumer, migration and export. This
 * is the only place the raw clipboard payload is ever seen.
 *
 * The transform itself is `src/lib/paste-normalizer.ts` — a pure function with the Word and
 * Google Docs fixture suite behind it since PR #6. This file adds no transformation logic of
 * its own on purpose: everything here is browser wiring, which is why the module split exists.
 *
 * WHY NOTHING IS INSERTED BEFORE THE PROMPT RESOLVES. Promoting headings after insertion would
 * mean tracking which nodes came from this paste and rewriting them in place, through a
 * selection the author may have moved. Asking first and inserting once reuses `promoteHeadings`
 * exactly as it is tested, and the author never sees content change under them.
 *
 * IMPORTS COME THROUGH PAYLOAD'S LEXICAL PROXY (`@payloadcms/richtext-lexical/lexical/*`)
 * rather than from `lexical` directly. Payload publishes the proxy so consumers do not pin
 * their own copy of Lexical: a second copy would be a second module registry, and nodes
 * created against one are unrecognisable to the other.
 */
export const PasteNormalizerPlugin = () => {
  const [editor] = useLexicalComposerContext()
  const [pending, setPending] = useState<NormalizedPaste | null>(null)

  const insert = useCallback(
    (html: string) => {
      if (html === '') return

      editor.update(() => {
        const dom = new DOMParser().parseFromString(html, 'text/html')
        const nodes = $generateNodesFromDOM(editor, dom)

        /**
         * The selection survives the modal — Lexical keeps it in the editor state rather than
         * dropping it on blur, and `<dialog>` returns focus to the editor on close. The
         * fallback is for the case where there is genuinely no selection to insert at, such as
         * a paste into a field that has never been focused.
         */
        if (!$isRangeSelection($getSelection())) $getRoot().selectEnd()

        $insertNodes(nodes)
      })
    },
    [editor],
  )

  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent)) return false

          const html = event.clipboardData?.getData('text/html')

          /**
           * No HTML flavour means a plain-text paste, which carries no markup to strip and no
           * structure to mistake for one. Lexical's own handling is correct there, so this
           * returns false and stays out of the way.
           */
          if (!html || html.trim() === '') return false

          event.preventDefault()
          const normalized = normalizePastedHtml(html)

          // Nothing removed and nothing to ask about: the common case, and it must not cost
          // the author a dialog.
          if (normalized.rejections.length === 0 && normalized.headingCandidates.length === 0) {
            insert(normalized.html)
            return true
          }

          setPending(normalized)
          return true
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    [editor, insert],
  )

  /**
   * Every exit inserts. `promote` false covers the author saying no, Escape, and the case
   * where there was never a heading question — losing a pasted agenda to a dismissed dialog
   * would be a worse outcome than an unpromoted heading.
   */
  const resolve = useCallback(
    (promote: boolean) => {
      if (!pending) return
      setPending(null)

      insert(
        promote
          ? promoteHeadings(
              pending.html,
              pending.headingCandidates.map((candidate) => candidate.blockIndex),
            )
          : pending.html,
      )
    },
    [pending, insert],
  )

  return (
    <PastePrompt
      candidates={pending?.headingCandidates ?? []}
      onResolve={resolve}
      open={pending !== null}
      rejections={pending?.rejections ?? []}
    />
  )
}
