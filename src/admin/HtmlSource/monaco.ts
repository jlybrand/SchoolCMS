'use client'

import type * as Monaco from 'monaco-editor'

/**
 * MONACO, BUNDLED — never fetched from a CDN (Jason, 2026-11-19: "add payloads code editor by
 * bundling").
 *
 * Payload's `CodeEditor` (`@payloadcms/ui`, Monaco through `@monaco-editor/react`) otherwise
 * downloads Monaco at runtime from `cdn.jsdelivr.net/npm/monaco-editor@0.55.1` — third-party
 * script in the admin, outside the lockfile and the dependency audit (`09` §8), and a box that
 * will not open when the CDN is down or blocked. Its loader uses `window.monaco` when one is
 * already there, so this imports our own pinned copy (`monaco-editor`, exact 0.55.1 — the
 * version Payload's loader names) and sets it there first. Revisit the pin with every Payload
 * bump (`09` §2).
 *
 * ONLY WHAT THE HTML VIEW USES: the editor core and HTML highlighting — not the 80-odd other
 * languages `monaco-editor`'s main entry registers. Loaded on first use, so the admin's first
 * paint never carries it.
 *
 * `DD2_CODE_THEME` is Monaco's light theme with the one color that fails AA on white replaced —
 * HTML attribute names, #FF0000 (4.0:1) → #B00000 (7.4:1). The rest of `vs` passes 4.5:1.
 */

export const DD2_CODE_THEME = 'dd2-light'

let loading: Promise<typeof Monaco> | null = null

export const loadMonaco = (): Promise<typeof Monaco> =>
  (loading ??= (async () => {
    const monaco =
      (await import('monaco-editor/esm/vs/editor/edcore.main.js')) as unknown as typeof Monaco
    await import('monaco-editor/esm/vs/basic-languages/html/html.contribution.js')

    // Monaco's background work (link detection, diffing) runs in a worker of our own bundle.
    ;(self as unknown as { MonacoEnvironment: Monaco.Environment }).MonacoEnvironment = {
      getWorker: () =>
        new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), {
          type: 'module',
        }),
    }

    monaco.editor.defineTheme(DD2_CODE_THEME, {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'attribute.name', foreground: 'B00000' },
        { token: 'attribute.name.html', foreground: 'B00000' },
      ],
      colors: {},
    })
    ;(window as unknown as { monaco: typeof Monaco }).monaco = monaco
    return monaco
  })())
