import type { Metadata } from 'next'
import type React from 'react'

import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'DD2 Website Platform',
  description: 'District-owned, accessibility-native web platform.',
}

/**
 * PHASE 0 STUB. `lang` and `dir` are hardcoded to English here.
 *
 * Phase 2 (`05`) replaces this with the real locale routing: `/{locale}/` path prefixes,
 * `lang` and `dir` derived from the active locale, and `hreflang` alternates. That work is
 * scaffolded early — before any translation exists — specifically so nothing built later
 * has to be re-plumbed (`08` §12).
 *
 * `lang` on <html> is WCAG 3.1.1 and `dir="rtl"` for Arabic is release-blocking (`08` §6).
 */
export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  )
}
