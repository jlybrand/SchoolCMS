import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'

import { ADMIN_STORAGE_STATE } from './admin-session'
import { uniqueTitle } from './fixture-pages'
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

/** The first row a list returns — the seed gives every site a board and the district tags. */
const firstId = async (admin: APIRequestContext, path: string): Promise<number> => {
  const res = await admin.get(`${path}${path.includes('?') ? '&' : '?'}limit=1&depth=0`)
  expect(res.ok(), `lookup ${path}`).toBe(true)
  const [doc] = (await res.json()).docs as { id: number }[]
  expect(doc, `the seed creates ${path}`).toBeDefined()
  return doc!.id
}

export const makePost = async (
  baseURL: string | undefined,
  {
    /**
     * Unique by default: the axe spec's runs each make one at once, and two
     * posts of the same title race for the same numbered address (`uniquePostSlug`) — one lost.
     */
    title = uniqueTitle('Axe announcement'),
    /** Shared with the school itself, so the form shows the chosen-sites field with a chip. */
    selected = false,
    /** A tag ticked, so the form shows the tags field with a chip. */
    tagged = false,
  } = {},
): Promise<FixturePost> => {
  const admin = await playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })
  const tenant = await tenantIdFor(admin, SCHOOL_HOSTNAME)
  // News by name: a spec may briefly give School A a second board, and "first" would be a race.
  const board = await firstId(
    admin,
    `/api/post-boards?where[tenant][equals]=${tenant}&where[name][equals]=News`,
  )
  const tag = tagged ? await firstId(admin, '/api/post-tags?sort=name') : null
  const res = await admin.post('/api/posts?draft=true&depth=0', {
    data: {
      title,
      tenant,
      board,
      ...(tag === null ? {} : { tags: [tag] }),
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
