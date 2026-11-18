import { DefaultTemplate } from '@payloadcms/next/templates'
import type { AdminViewServerProps } from 'payload'
import type { ReactNode } from 'react'

/**
 * A custom admin view in Payload's frame — the side menu and top bar. A custom view gets the
 * frame only by wrapping itself in `DefaultTemplate`, with the props Payload's own root view hands
 * it. Used by the file library and a site's pages.
 */
export const inPayloadFrame = (props: AdminViewServerProps, children: ReactNode) => {
  const { initPageResult, searchParams } = props
  const { req } = initPageResult
  return (
    <DefaultTemplate
      i18n={req.i18n}
      payload={req.payload}
      permissions={initPageResult.permissions}
      req={req}
      visibleEntities={{
        // Copied, not passed through: React 19 refuses the read-only original (as Payload's root).
        collections: [...initPageResult.visibleEntities.collections],
        globals: [...initPageResult.visibleEntities.globals],
      }}
      {...(initPageResult.locale ? { locale: initPageResult.locale } : {})}
      {...(props.params ? { params: props.params } : {})}
      {...(searchParams ? { searchParams } : {})}
      {...(req.user ? { user: req.user } : {})}
    >
      {children}
    </DefaultTemplate>
  )
}
