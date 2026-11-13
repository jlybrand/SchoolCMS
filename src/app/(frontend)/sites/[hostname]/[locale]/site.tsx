import type { ReactNode } from 'react'

import { AlertBar } from '@/components/AlertBar'
import { SiteFooter } from '@/components/SiteFooter'
import { SiteHeader } from '@/components/SiteHeader'
import { MAIN_CONTENT_ID } from '@/components/SkipLink'
import { getAlerts } from '@/content/alerts'
import { getNavigation } from '@/content/navigation'
import { getSettings } from '@/content/settings'
import { getTenantByHostname } from '@/content/tenants'
import type {
  AlertPageRef,
  ContentContext,
  Navigation,
  SiteSettings,
  Tenant,
} from '@/content/types'

/**
 * What every public page of a site shares: finding the site, and the frame around its content.
 * Used by the page route and the announcement routes, so they cannot disagree about either.
 *
 * NOT A ROUTE. A plain module beside them; Next treats only `page`, `layout` and `route` files
 * specially. It does not import Payload — it is on the public side of the boundary (`02` §11).
 */

export type SiteParams = { hostname: string; locale: string }

export type Site = {
  tenant: Tenant
  ctx: ContentContext
  settings: SiteSettings
  /** `settings.siteTitle`, else the tenant's name — decided once, for the tab and the chrome. */
  siteName: string
}

/**
 * The site for a request, or null to 404.
 *
 * An unknown host is NEVER served a default tenant's content (`02` §4.1). A locale this tenant
 * has not enabled is not a page either (`03` §5, `08` §2): the proxy, at the edge with no
 * database, recognises every platform locale, and the per-tenant answer is given here. A tenant
 * with no `settings` row gets every platform locale, never null.
 */
export const resolveSite = async (params: SiteParams): Promise<Site | null> => {
  const tenant = await getTenantByHostname(decodeURIComponent(params.hostname))
  if (!tenant) return null

  const settings = await getSettings({ tenant })
  if (!settings.enabledLocales.includes(params.locale)) return null

  return {
    tenant,
    ctx: { tenant, locale: params.locale },
    settings,
    siteName: settings.siteTitle ?? tenant.name,
  }
}

/**
 * The header, `<main>` and footer.
 *
 * Rendered by each page rather than the layout, because the layout cannot see the path: the
 * menus need it for `aria-current`, the one thing a menu owes a screen-reader user. Header and
 * footer are siblings of `<main>` directly under `<body>`, which makes them the banner and
 * contentinfo landmarks; the skip link, in the layout, still comes first.
 *
 * `cacheTags` go on `<main>` (`09` §4.2). Navigation is fetched here, once the page is known to
 * exist, so a 404 costs no menu query. A tenant with no menus gets three empty ones.
 */
export const SiteFrame = async ({
  site,
  currentPath,
  cacheTags,
  alertPage = null,
  children,
}: {
  site: Site
  currentPath: string
  cacheTags: string
  /**
   * The page being shown, for alerts placed on home pages or chosen pages (Jason, 2026-11-12).
   * Null for a screen that is not a page — it shows only the alerts placed on every page.
   */
  alertPage?: AlertPageRef
  children: ReactNode
}) => {
  const [navigation, alerts]: [Navigation, Awaited<ReturnType<typeof getAlerts>>] =
    await Promise.all([getNavigation(site.ctx), getAlerts(site.ctx, alertPage)])
  return (
    <>
      {/* Above the header: what a visitor must know first (`04` §3.4). */}
      <AlertBar alerts={alerts} />
      <SiteHeader
        siteName={site.siteName}
        primary={navigation.primary}
        utility={navigation.utility}
        currentPath={currentPath}
        locale={site.ctx.locale}
        locales={site.settings.enabledLocales}
      />
      <main data-cache-tag={cacheTags} id={MAIN_CONTENT_ID}>
        {children}
      </main>
      <SiteFooter
        siteName={site.siteName}
        links={navigation.footer}
        contact={site.settings.contact}
        social={site.settings.social}
        currentPath={currentPath}
        locale={site.ctx.locale}
      />
    </>
  )
}
