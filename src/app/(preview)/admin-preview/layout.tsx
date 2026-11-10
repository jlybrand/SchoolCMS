import type { Metadata } from 'next'
import type React from 'react'

import { SkipLink } from '@/components/SkipLink'

import '@/styles/globals.css'

/**
 * The Live Preview frame's document (Jason, 2026-11-10). Its own root layout: the public site's
 * sets `lang`, `dir` and the theme from the tenant route, which this route is not under.
 *
 * English and left-to-right: what the editor writes is English (translation is render-layer,
 * Phase 7, `08`). Never indexed — it is a draft behind a sign-in.
 */
export const metadata: Metadata = {
  title: 'Page preview',
  robots: { index: false, follow: false },
}

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <SkipLink>Skip to main content</SkipLink>
        {children}
      </body>
    </html>
  )
}
