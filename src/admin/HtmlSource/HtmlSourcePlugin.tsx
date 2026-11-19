'use client'

import {
  $createParagraphNode,
  $getRoot,
  $parseSerializedNode,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalCommand,
  type SerializedLexicalNode,
} from '@payloadcms/richtext-lexical/lexical'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { useCallback, useEffect, useState } from 'react'

import {
  htmlToLexical,
  lexicalToHtml,
  type HtmlSourceResult,
  type SourceContext,
  type SourceImage,
} from '@/lib/html-source'

import { CodeBox } from './CodeBox'
import { HtmlSourceDialog } from './HtmlSourceDialog'

/** Dispatched by the toolbar's "HTML code" button; this plugin opens the dialog. */
export const OPEN_HTML_SOURCE_COMMAND: LexicalCommand<void> = createCommand('OPEN_HTML_SOURCE')

type Opened = { code: string; ctx: SourceContext; opening: number }

const uploadIds = (root: { children?: unknown[] }): (string | number)[] =>
  (root.children ?? []).flatMap((node) => {
    const n = node as { type?: string; relationTo?: string; value?: unknown }
    const value =
      typeof n.value === 'object' && n.value !== null ? (n.value as { id?: unknown }).id : n.value
    return n.type === 'upload' &&
      n.relationTo === 'resources' &&
      (typeof value === 'number' || typeof value === 'string')
      ? [value]
      : []
  })

/**
 * The text's library images, so the HTML can name them by their real address and alt text. One
 * request, as the signed-in author. An image it cannot look up keeps a stand-in address, so
 * updating the text never drops it.
 */
const lookUpImages = async (
  ids: (string | number)[],
): Promise<Map<string | number, SourceImage>> => {
  const images = new Map<string | number, SourceImage>()
  if (ids.length > 0) {
    try {
      const query = new URLSearchParams({ depth: '0', limit: String(ids.length) })
      query.set('where[id][in]', ids.join(','))
      const response = await fetch(`/api/resources?${query.toString()}`, { credentials: 'include' })
      const body = (await response.json()) as {
        docs?: { id: number; url?: string; alt?: string }[]
      }
      for (const doc of body.docs ?? [])
        if (doc.url) images.set(doc.id, { src: doc.url, alt: doc.alt ?? '' })
    } catch {
      // The stand-ins below keep every image.
    }
  }
  for (const id of ids) if (!images.has(id)) images.set(id, { src: `#library-file-${id}`, alt: '' })
  return images
}

/**
 * Wires the HTML view into the editor. No transformation here: `lexicalToHtml` writes the text,
 * `htmlToLexical` reads it back, and this replaces the text's contents with the result — one
 * update, so one Undo puts it back.
 */
export const HtmlSourcePlugin = () => {
  const [editor] = useLexicalComposerContext()
  const [opened, setOpened] = useState<Opened | null>(null)

  useEffect(
    () =>
      editor.registerCommand(
        OPEN_HTML_SOURCE_COMMAND,
        () => {
          const root = editor.getEditorState().toJSON().root as { children?: unknown[] }
          void lookUpImages(uploadIds(root)).then((images) => {
            const ctx: SourceContext = { images }
            setOpened({ code: lexicalToHtml(root, ctx), ctx, opening: Date.now() })
          })
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor],
  )

  const apply = useCallback(
    (result: HtmlSourceResult) => {
      setOpened(null)
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        for (const child of result.children)
          root.append($parseSerializedNode(child as unknown as SerializedLexicalNode))
        // An editor is never without a block to type in.
        if (root.getChildrenSize() === 0) root.append($createParagraphNode())
        root.selectEnd()
      })
    },
    [editor],
  )

  const ctx = opened?.ctx
  const check = useCallback(
    (code: string) => htmlToLexical(code, ctx ?? { images: new Map() }),
    [ctx],
  )

  return (
    <HtmlSourceDialog
      key={opened?.opening ?? 0}
      check={check}
      code={opened?.code ?? ''}
      codeInput={(props) => <CodeBox {...props} />}
      onApply={apply}
      onClose={() => setOpened(null)}
      open={opened !== null}
    />
  )
}
