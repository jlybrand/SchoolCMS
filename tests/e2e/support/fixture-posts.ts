import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'

import { ADMIN_STORAGE_STATE } from './admin-session'
import { SCHOOL_HOSTNAME, tenantIdFor } from './school-session'

/**
 * Throwaway posts, made by the district admin through REST and deleted after — the posts
 * counterpart of `fixture-pages.ts`, for the same reason.
 */

export type FixturePost = { id: number; admin: APIRequestContext }

const BODY = {
  root: {
    type: 'root',
    children: [
      { type: 'paragraph', version: 1, children: [{ type: 'text', text: 'Body.', version: 1 }] },
    ],
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  },
}

export const makePost = async (
  baseURL: string | undefined,
  {
    title = 'Axe announcement',
    /** Shared with the school itself, so the form shows the chosen-sites field with a chip. */
    selected = false,
  } = {},
): Promise<FixturePost> => {
  const admin = await playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })
  const tenant = await tenantIdFor(admin, SCHOOL_HOSTNAME)
  const res = await admin.post('/api/posts?draft=true&depth=0', {
    data: {
      title,
      tenant,
      body: BODY,
      visibility: 'public',
      ...(selected ? { syndication: { scope: 'selected', syndicatedTo: [tenant] } } : {}),
      _status: 'draft',
    },
  })
  expect(res.ok(), `create fixture post: ${res.status()} ${await res.text()}`).toBe(true)
  return { id: ((await res.json()).doc as { id: number }).id, admin }
}

export const dropPost = async ({ id, admin }: FixturePost) => {
  await admin.delete(`/api/posts/${id}`)
  await admin.dispose()
}
