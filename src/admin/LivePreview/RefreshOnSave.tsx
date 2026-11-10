'use client'

import { RefreshRouteOnSave } from '@payloadcms/live-preview-react'
import { useRouter } from 'next/navigation'

/**
 * Live Preview (Jason, 2026-11-10): re-render the preview whenever the form beside it saves —
 * autosave included, so the page follows the editor's typing within a couple of seconds.
 *
 * Payload's admin posts a message to the preview frame on every save; this hears it and asks
 * Next for the route again, which reads the new draft through `src/content/preview.ts`.
 *
 * ON THE ADMIN SIDE OF THE BOUNDARY, deliberately: it is the one Payload-specific piece of the
 * preview, and it is the piece that goes if Payload does. The route that renders the page
 * (`src/app/(preview)/`) imports only this component, never the SDK (CLAUDE.md rule 1).
 */
export const RefreshOnSave = ({ serverURL }: { serverURL: string }) => {
  const router = useRouter()
  return <RefreshRouteOnSave refresh={() => router.refresh()} serverURL={serverURL} />
}
