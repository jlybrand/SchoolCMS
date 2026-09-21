import type React from 'react'

import { SkipLink } from '@/components/SkipLink'
import { getTenantByHostname } from '@/content/tenants'
import { getTheme } from '@/content/theme'
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
  params: Promise<{ hostname: string; locale: string }>
}) {
  const { hostname, locale } = await params

  /**
   * The tenant's theme, as custom properties on `<html>` (`02` §4.4): "the shared component
   * library reads tokens at render. No per-tenant CSS forks." Every stylesheet already reads
   * `var(--color-brand)`; this changes what that resolves to, for this site only, and
   * touches no component.
   *
   * ON `<html>`, because `tokens.css` declares on `:root` and an inline declaration on the
   * same element is what outranks it without a specificity argument.
   *
   * An inline `style`, which CLAUDE.md warns off for anything LAYOUT-bearing because
   * stylelint cannot see it. These are colours, from a closed map of property names, each
   * value an exact `#rrggbb` that has already passed the contrast pairs (`toTheme`) — there
   * is no direction in them to get wrong and no string in them a person typed freely.
   *
   * An unknown host gets no theme; the page below 404s it (`02` §4.1). Resolved at build or
   * revalidate time like everything else here, never per visitor (`02` §5).
   */
  const tenant = await getTenantByHostname(decodeURIComponent(hostname))
  const theme = tenant ? await getTheme({ tenant }) : { tokens: {} }

  return (
    <html lang={locale} dir={dirFor(locale)} style={theme.tokens as React.CSSProperties}>
      <body>
        {/*
          First element in the body so it is the first thing focus reaches — WCAG 2.4.1
          (`07` §3). Its target id comes from the component, so the link and the `<main>` it
          points at cannot drift apart. The label is English until the render-layer
          translation pipeline lands (Phase 7, `08` §4), like every other string on the page.
        */}
        <SkipLink>Skip to main content</SkipLink>
        {children}
      </body>
    </html>
  )
}
