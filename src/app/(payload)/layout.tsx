/* THIS FILE IS PAYLOAD'S OWN MOUNT POINT — see the scope note in eslint.config.mjs.
 * It is exempt from the content-access-layer boundary rule because Payload 3 mounts its
 * admin UI as App Router routes and these files import @payloadcms/next by construction.
 * No DD2 rendering logic belongs here. The public site lives in src/app/(frontend).
 */
import type { ServerFunctionClient } from 'payload'
import type React from 'react'

import config from '@payload-config'
import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts'

import { importMap } from './admin/importMap.js'

import '@payloadcms/next/css'

// After Payload's own sheet. Contrast corrections only — see the file's header.
import './admin-overrides.css'
// The platform's brand (Jason, 2026-11-18) — after the fixes, which it never undoes.
import './admin-brand.css'

const serverFunction: ServerFunctionClient = async function (args) {
  'use server'
  return handleServerFunctions({ ...args, config, importMap })
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
      {children}
    </RootLayout>
  )
}
