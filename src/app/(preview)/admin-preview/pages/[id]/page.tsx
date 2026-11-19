import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import type React from 'react'

import { RefreshOnSave } from '@/admin/LivePreview/RefreshOnSave'
import { BlockList } from '@/blocks'
import { Container } from '@/components/Container'
import { Heading, PAGE_TITLE_LEVEL } from '@/components/Heading'
import { Stack } from '@/components/Stack'
import { getPagePreview, getPreviewer, type PagePreview } from '@/content/preview'
import { resolvePageBlocks } from '@/content/resolve-blocks'
import { getTheme } from '@/content/theme'

import { resolveSite, SiteFrame } from '../../../../(frontend)/sites/[hostname]/[locale]/site'

/**
 * LIVE PREVIEW (Jason, 2026-11-10): a page's newest version — what the editor is typing — in its
 * site's own header, theme, components and footer, framed beside the form by Payload's Live
 * Preview panel (`admin.livePreview` in `src/collections/Pages.ts`).
 *
 * On the ADMIN host, at `/admin-preview/…`, which the tenant proxy leaves alone: the admin's
 * session cookie reaches it, and `getPagePreview` reads the draft AS that person, so a school
 * manager previews only their own school's pages (`tests/integration/page-preview.test.ts`).
 * Anyone else gets a 404, never a hint the page exists.
 *
 * Never cached: it is one person's unsent draft, and it must show the save that just happened.
 */
export const dynamic = 'force-dynamic'

/** Where a linked page's link points, as an address: `a.example.org/calendar`. */
const address = (to: { hostname: string; path: string }) => `${to.hostname}${to.path}`

/**
 * A LINKED page's line under its title (Jason, 2026-11-19): the preview shows what a visitor
 * gets, and this says why it is not the page's own sections. Plain text, not a link — the
 * public address is on another host, and the preview frame is the admin's.
 */
const linkNote = (link: PagePreview['link']): string | null => {
  if (!link) return null
  if (link.kind === 'reuse') return `This page shows the district page at ${address(link.from)}.`
  if (link.kind === 'redirect') return `Visitors to this page are sent to ${address(link.to)}.`
  return 'Visitors find nothing here: the page this is linked to is not published, or is staff only.'
}

export default async function PagePreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const requestHeaders = await headers()
  const preview = await getPagePreview(id, await getPreviewer(requestHeaders))
  if (!preview) notFound()

  const site = await resolveSite({ hostname: preview.hostname, locale: 'en' })
  if (!site) notFound()
  const theme = await getTheme({ tenant: site.tenant })
  const blocks = await resolvePageBlocks(site.ctx, preview.layout, {
    serverUrl: process.env.NEXT_PUBLIC_SERVER_URL ?? '',
  })
  const note = linkNote(preview.link)
  const serverURL = `${requestHeaders.get('x-forwarded-proto') ?? 'http'}://${requestHeaders.get('host')}`

  return (
    /**
     * The tenant's colors, as the public layout puts them on `<html>` — here on the wrapper,
     * since this document's `<html>` is shared by every school's preview. Colors only, already
     * contrast-checked by `toTheme`; nothing layout-bearing.
     */
    <div style={theme.tokens as React.CSSProperties}>
      <RefreshOnSave serverURL={serverURL} />
      <SiteFrame site={site} currentPath="" cacheTags="">
        <Container>
          <Stack space="lg">
            <Heading level={PAGE_TITLE_LEVEL}>{preview.title}</Heading>
            {note ? <p>{note}</p> : null}
            <BlockList blocks={blocks} childPages={[]} />
          </Stack>
        </Container>
      </SiteFrame>
    </div>
  )
}
