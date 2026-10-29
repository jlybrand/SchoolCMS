import type { Locale } from '@/content/types'

import { localizedPath } from './locales'
import { siteOrigin } from './seo'

/**
 * Linked pages (Jason, 2026-10-29) — Finalsite's "Linked" page setting.
 *
 * INTERNAL REDIRECT: visiting the page sends the visitor to another page — a district page, or
 * one on the page's own site. Never an outside address: buttons, cards, menus and the words
 * carry those. ("Reuse content", which stays at the page's own address, is the next PR.)
 *
 * PURE. The fields are `src/collections/Pages.ts`; the content layer resolves the target to an
 * address (`src/content/pages.ts`); the route redirects.
 */

export type LinkMode = 'none' | 'redirect'

/** Where the target is chosen from — two pickers, so two "About" pages can't be confused. */
export type LinkTo = 'site' | 'district'

export type LinkTargetFacts = {
  id: string
  tenant: string | null
  tenantType: 'district' | 'school' | null
  linkMode: LinkMode | null
}

export type LinkTargetInput = {
  mode: unknown
  linkTo: unknown
  /** The page being saved — absent on create. */
  pageId?: string | null
  /** Its site. */
  pageTenant: string | null
  /** The chosen target's id, when one was chosen but could not be found. */
  targetId?: string | null
}

/**
 * The rules for a redirect target. `target` is the chosen page as looked up, or null when none
 * was chosen (or it could not be found — `targetId` tells the two apart).
 */
export const validateLinkTarget = (
  input: LinkTargetInput,
  target: LinkTargetFacts | null,
): true | string => {
  if (input.mode !== 'redirect') return true

  if (target === null) {
    return input.targetId
      ? 'That page no longer exists. Choose another.'
      : 'Choose the page to send visitors to.'
  }
  if (input.pageId !== undefined && input.pageId !== null && target.id === input.pageId) {
    return 'A page cannot send visitors to itself. Choose another page.'
  }
  if (input.linkTo === 'district') {
    if (target.tenantType !== 'district') return 'Choose a district page.'
  } else if (target.tenant === null || target.tenant !== input.pageTenant) {
    return 'Choose a page on this site.'
  }
  /** A chain is two hops for every visitor, and two linked pages pointing at each other loop. */
  if (target.linkMode !== null && target.linkMode !== 'none') {
    return 'That page already sends visitors somewhere else. Choose the page it leads to instead.'
  }
  return true
}

export const isLocalHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname.endsWith('.localhost')

/**
 * Where a redirect sends the visitor, in their language: a path when the target is on the
 * site they are on, a full address when it is on the district site.
 *
 * `port` is the visitor's, and only ever used between `*.localhost` sites: in development they
 * share one port and are told apart by hostname, so a full address without it lands on the
 * wrong server. A real host is never given one.
 */
export const redirectHref = (
  target: { path: string; hostname: string },
  currentHostname: string,
  locale: Locale,
  port?: string | null,
): string => {
  const path = localizedPath(target.path, locale)
  if (target.hostname === currentHostname) return path
  const keepPort = port && isLocalHost(target.hostname) && isLocalHost(currentHostname)
  return `${siteOrigin(target.hostname)}${keepPort ? `:${port}` : ''}${path}`
}
