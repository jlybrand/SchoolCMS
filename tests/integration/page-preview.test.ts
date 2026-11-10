import type { Payload, TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getPagePreview, type Previewer } from '@/content/preview'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * Live Preview (Jason, 2026-11-10): the page being edited, beside its form. It shows the DRAFT —
 * the newest version, not what is live — so it is read AS the person previewing, through the
 * same access functions as every other read: a school manager sees their own school's drafts and
 * nobody else's (`03` §6.4, CLAUDE.md rule 2). Nobody signed in sees nothing.
 */

let payload: Payload
let f: Fixtures
const made: number[] = []

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

afterAll(async () => {
  for (const id of made) {
    await payload.delete({ collection: 'pages', id, overrideAccess: true }).catch(() => null)
  }
})

const as = (user: TypedUser): Previewer => ({ user }) as Previewer

const words = (text: string) => ({
  root: {
    type: 'root',
    direction: null,
    format: '',
    indent: 0,
    version: 1,
    children: [{ type: 'paragraph', version: 1, children: [{ type: 'text', text, version: 1 }] }],
  },
})

/** A live page in `tenant` whose newest version is a draft with different words. */
const pageWithDraft = async (tenant: number) => {
  const page = await payload.create({
    collection: 'pages',
    data: {
      tenant,
      title: 'Lunch',
      slug: `preview-${Date.now()}-${made.length}`,
      visibility: 'public',
      layout: [{ blockType: 'richText', content: words('Live words.') as never }],
      _status: 'published',
    },
    user: f.districtAdmin,
    overrideAccess: true,
  })
  made.push(page.id as number)
  await payload.update({
    collection: 'pages',
    id: page.id,
    data: {
      title: 'Lunch menu',
      layout: [{ blockType: 'richText', content: words('Draft words.') as never }],
    },
    draft: true,
    user: f.districtAdmin,
    overrideAccess: true,
  })
  return String(page.id)
}

describe('getPagePreview', () => {
  it('shows the district the DRAFT — the newest version, not what is live', async () => {
    const id = await pageWithDraft(f.tenantA)
    const preview = await getPagePreview(id, as(f.districtAdmin))
    expect(preview?.title).toBe('Lunch menu')
    expect(JSON.stringify(preview?.layout)).toContain('Draft words.')
    expect(JSON.stringify(preview?.layout)).not.toContain('Live words.')
    expect(preview?.hostname).toBe('a.localhost')
  })

  it('shows a school manager their own school’s draft', async () => {
    const id = await pageWithDraft(f.tenantA)
    expect((await getPagePreview(id, as(f.managerA)))?.title).toBe('Lunch menu')
  })

  it('shows a school manager NOTHING of another school’s page', async () => {
    const id = await pageWithDraft(f.tenantB)
    expect(await getPagePreview(id, as(f.managerA))).toBeNull()
  })

  it('shows nobody signed in nothing', async () => {
    const id = await pageWithDraft(f.tenantA)
    expect(await getPagePreview(id, null)).toBeNull()
  })

  it('an unknown or malformed id is nothing, not an error', async () => {
    expect(await getPagePreview('999999', as(f.districtAdmin))).toBeNull()
    expect(await getPagePreview('not-a-number', as(f.districtAdmin))).toBeNull()
  })
})
