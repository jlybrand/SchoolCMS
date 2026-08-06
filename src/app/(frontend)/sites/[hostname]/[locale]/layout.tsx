import type React from 'react'

import { dirFor } from '@/lib/locales'

import '@/styles/globals.css'

/**
 * Root layout for the public site.
 *
 * `lang` and `dir` come from the route, so they are correct by construction on every page
 * rather than set by a component that might be forgotten:
 *
 *   - `lang` on `<html>` is WCAG 3.1.1 Language of Page
 *   - `dir="rtl"` for Arabic is release-blocking (`08` §6)
 *
 * Both are part of the routing shape scaffolded in Phase 2, before any translation exists,
 * precisely so nothing built later has to be re-plumbed (`05` Phase 2, `08` §12).
 *
 * This file does NOT import Payload — it is on the public side of the content-access
 * boundary and CI enforces that (`02` §11).
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body>{children}</body>
    </html>
  )
}
