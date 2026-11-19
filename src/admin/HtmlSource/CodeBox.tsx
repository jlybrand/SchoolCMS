'use client'

import { CodeEditor } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import { DD2_CODE_THEME, loadMonaco } from './monaco'

/**
 * The HTML view's code box: Payload's `CodeEditor` (Monaco) with HTML highlighting, our bundled
 * Monaco (`./monaco.ts`), and three accessibility settings:
 *
 *   - `tabFocusMode` — Tab and Shift+Tab move focus in and out, as in any other field. Monaco's
 *     default keeps Tab for indenting, a keyboard trap a person has to know Ctrl+M to leave
 *     (WCAG 2.1.2). Indenting is not needed: the HTML is read back the same either way.
 *   - `ariaLabel` — Monaco's input is a hidden textarea a `<label for>` cannot reach, so the
 *     dialog's visible label is given to it here.
 *   - 15px text (min-text-15px).
 */

const MIN_HEIGHT = 440

export type CodeBoxProps = {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly label: string
}

export const CodeBox = ({ value, onChange, label }: CodeBoxProps) => {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    void loadMonaco().then(() => {
      if (live) setReady(true)
    })
    return () => {
      live = false
    }
  }, [])

  if (!ready) return <p role="status">Opening the code editor…</p>

  // Large (Jason, 2026-11-19: "okay with the html editor being larger"): it starts tall and grows
  // with the code up to the window's height, less the dialog's words and buttons.
  const tallest = Math.max(
    MIN_HEIGHT,
    (typeof window === 'undefined' ? 800 : window.innerHeight) - 300,
  )

  return (
    <CodeEditor
      defaultLanguage="html"
      maxHeight={tallest}
      minHeight={MIN_HEIGHT}
      onChange={(next) => onChange(next ?? '')}
      onMount={(editor) => editor.focus()}
      options={{
        ariaLabel: label,
        fontSize: 15,
        insertSpaces: true,
        lineNumbers: 'on',
        tabFocusMode: true,
        tabSize: 2,
      }}
      theme={DD2_CODE_THEME}
      value={value}
    />
  )
}
