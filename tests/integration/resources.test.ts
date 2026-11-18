import { existsSync } from 'node:fs'
import path from 'node:path'

import { createLocalReq, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { listMyFolders } from '@/admin/SchoolPlane/school-data'

import { tinyPdf, tinyPng } from '../helpers/files'
import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * The Resources library over the real stack (Jason, 2026-11-13): one library of a site's images
 * and documents, in folders. Rule 7 holds on every route — the Local API with access overridden
 * included; a document carries its attestation; schools upload to their own school with no
 * approval; nothing crosses schools; every change is in the activity log.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

type Row = Record<string, unknown>

/** A refusal, by its words: Payload keeps each field's message in the error's data. */
const refusal = async (attempt: Promise<unknown>): Promise<string> => {
  try {
    await attempt
  } catch (err) {
    return JSON.stringify((err as { data?: unknown }).data ?? (err as Error).message)
  }
  throw new Error('expected a refusal; the write went through')
}

const upload = async (
  data: Row,
  file: { data: Buffer; mimetype: string; name: string; size: number },
  as: { user?: unknown; overrideAccess?: boolean } = { user: f.districtAdmin },
) =>
  payload.create({
    collection: 'resources',
    data: { tenant: f.tenantA, title: 'A file', ...data } as never,
    file,
    user: as.user as never,
    overrideAccess: as.overrideAccess ?? false,
  })

describe('images: alt text, unless decorative (CLAUDE.md rule 7)', () => {
  it('refused without alt — even with access overridden, so no route skips it', async () => {
    const message = 'Describe the image for people who can’t see it, or mark it decorative.'
    expect(await refusal(upload({}, await tinyPng()))).toContain(message)
    expect(await refusal(upload({ alt: '   ' }, await tinyPng()))).toContain(message)
    expect(
      await refusal(upload({}, await tinyPng(), { user: null, overrideAccess: true })),
    ).toContain(message)
  })

  it('kept with alt, or marked decorative; its sizes made', async () => {
    const described = (await upload(
      { alt: 'Students at the science fair' },
      await tinyPng(1200, 800),
    )) as unknown as Row
    expect(described).toMatchObject({ kind: 'image', alt: 'Students at the science fair' })
    const sizes = described.sizes as Record<string, { width?: number | null; url?: string | null }>
    expect(sizes.thumbnail?.width).toBe(400)
    expect(sizes.card?.width).toBe(800)
    expect(sizes.thumbnail?.url).toMatch(/\.webp$/)

    expect(await upload({ isDecorative: true }, await tinyPng())).toMatchObject({ kind: 'image' })
  })

  it('removing the alt text later is refused too', async () => {
    const image = await upload({ alt: 'A bus' }, await tinyPng())
    expect(
      await refusal(
        payload.update({
          collection: 'resources',
          id: image.id,
          data: { alt: '' } as never,
          user: f.districtAdmin,
          overrideAccess: false,
        }),
      ),
    ).toContain('Describe the image')
  })
})

describe('documents: the accessibility attestation (`07` §5)', () => {
  it('refused without one', async () => {
    expect(await refusal(upload({}, tinyPdf()))).toContain(
      'Say whether this document has been checked for accessibility.',
    )
  })

  /** Jason, 2026-11-16: two answers only — checked, or not checked yet. */
  it('"not needed" is refused on every route, as no answer is', async () => {
    expect(await refusal(upload({ remediationStatus: 'not-applicable' }, tinyPdf()))).toMatch(
      /checked for accessibility|not a valid|invalid/i,
    )
  })

  it('attesting records who and when; anything else records neither', async () => {
    const checked = (await upload({ remediationStatus: 'attested' }, tinyPdf())) as unknown as Row
    expect(checked).toMatchObject({ kind: 'document', remediationStatus: 'attested' })
    const by = checked.attestedBy as { id?: unknown } | number
    expect(typeof by === 'object' ? by.id : by).toBe(f.districtAdmin.id)
    expect(checked.attestedAt).toBeTruthy()

    const unchecked = (await upload(
      { remediationStatus: 'not-attested' },
      tinyPdf(),
    )) as unknown as Row
    expect(unchecked.attestedBy ?? null).toBeNull()
    expect(unchecked.attestedAt ?? null).toBeNull()
  })
})

describe('nothing but images and documents', () => {
  it('no video (YouTube only — Jason), no SVG', async () => {
    const video = {
      data: Buffer.from('not really a video'),
      mimetype: 'video/mp4',
      name: 'clip.mp4',
      size: 18,
    }
    const svg = {
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      mimetype: 'image/svg+xml',
      name: 'logo.svg',
      size: 70,
    }
    await expect(upload({}, video)).rejects.toThrow()
    await expect(upload({ alt: 'Logo' }, svg)).rejects.toThrow()
  })
})

describe('schools: their own library, no approval (Jason)', () => {
  it('a school manager uploads to their own school — not another’s', async () => {
    expect(await upload({ alt: 'Our gym' }, await tinyPng(), { user: f.managerA })).toMatchObject({
      kind: 'image',
    })
    await expect(
      upload({ tenant: f.tenantB, alt: 'Their gym' }, await tinyPng(), { user: f.managerA }),
    ).rejects.toThrow()
  })

  it('reads, changes and removes only their own school’s', async () => {
    const theirs = await upload(
      { tenant: f.tenantB, title: 'School B only', alt: 'A field' },
      await tinyPng(),
    )
    const mine = await upload({ title: 'School A file', alt: 'A hall' }, await tinyPng(), {
      user: f.managerA,
    })

    const { docs } = await payload.find({
      collection: 'resources',
      user: f.managerA,
      overrideAccess: false,
      limit: 0,
    })
    expect(docs.map((d) => d.id)).toContain(mine.id)
    expect(docs.map((d) => d.id)).not.toContain(theirs.id)

    await expect(
      payload.update({
        collection: 'resources',
        id: theirs.id,
        data: { title: 'Mine now' } as never,
        user: f.managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.delete({
        collection: 'resources',
        id: theirs.id,
        user: f.managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await payload.delete({
      collection: 'resources',
      id: mine.id,
      user: f.managerA,
      overrideAccess: false,
    })
  })

  it('the public reads every file — they are the website’s', async () => {
    const file = await upload({ title: 'Public notice', alt: 'A notice' }, await tinyPng())
    const { docs } = await payload.find({
      collection: 'resources',
      overrideAccess: false,
      limit: 0,
    })
    expect(docs.map((d) => d.id)).toContain(file.id)
  })
})

describe('folders', () => {
  const folder = (data: Row, user: unknown = f.districtAdmin) =>
    payload.create({
      collection: 'resource-folders',
      data: { tenant: f.tenantA, ...data } as never,
      user: user as never,
      overrideAccess: false,
    })

  it('nest, each named with its path', async () => {
    const forms = await folder({ name: 'Forms' })
    const enrollment = await folder({ name: 'Enrollment', parent: forms.id })
    const year = await folder({ name: '2026', parent: enrollment.id }, f.managerA)
    expect((year as unknown as Row).label).toBe('Forms › Enrollment › 2026')
  })

  it('never inside itself, nor in another school’s', async () => {
    const top = await folder({ name: 'Top' })
    const inner = await folder({ name: 'Inner', parent: top.id })
    expect(
      await refusal(
        payload.update({
          collection: 'resource-folders',
          id: top.id,
          data: { parent: inner.id } as never,
          user: f.districtAdmin,
          overrideAccess: false,
        }),
      ),
    ).toContain('A folder can’t go inside itself.')

    const elsewhere = await folder({ tenant: f.tenantB, name: 'School B' })
    expect(await refusal(folder({ name: 'Stray', parent: elsewhere.id }))).toContain(
      'Choose a folder from this school’s library.',
    )
  })

  it('a file goes in its own school’s folder only', async () => {
    const theirs = await folder({ tenant: f.tenantB, name: 'B forms' })
    expect(
      await refusal(upload({ folder: theirs.id, remediationStatus: 'attested' }, tinyPdf())),
    ).toContain('Choose a folder from this school’s library.')
  })
})

describe('tags and the activity log', () => {
  it('tags are tidied; an upload and a removal are each in the log, for the school', async () => {
    const file = (await upload(
      {
        title: 'Lunch menu',
        tagsText: ' Lunch, menus ,lunch,',
        remediationStatus: 'attested',
      },
      tinyPdf(),
    )) as unknown as Row
    expect(file.tags).toEqual(['Lunch', 'menus'])

    await payload.delete({
      collection: 'resources',
      id: file.id as number,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const { docs } = await payload.find({
      collection: 'audit-events',
      where: {
        and: [
          { contentType: { equals: 'resources' } },
          { documentId: { equals: String(file.id) } },
        ],
      },
      sort: 'createdAt',
      depth: 0,
      overrideAccess: true,
    })
    expect(docs.map((d) => d.action)).toEqual(['publish', 'delete'])
    expect(docs.every((d) => d.tenant === f.tenantA)).toBe(true)
    expect(docs[0]!.documentTitle).toBe('Lunch menu')
  })
})

/**
 * Replace a file (Jason, 2026-11-16): a new file in the old one's place — the same kind only —
 * keeping its library entry, so every page using it shows the new one. A replaced document is
 * marked not checked; a school replaces its own files with no approval; the log says so.
 */
describe('replacing a file', () => {
  const replace = (
    id: number | string,
    file: { data: Buffer; mimetype: string; name: string; size: number },
    data: Row = {},
    as: { user?: unknown; overrideAccess?: boolean } = { user: f.districtAdmin },
  ) =>
    payload.update({
      collection: 'resources',
      id,
      data: data as never,
      file,
      user: as.user as never,
      overrideAccess: as.overrideAccess ?? false,
    })

  it('an image for an image keeps its place; the new file’s sizes are made, the old ones gone', async () => {
    const before = (await upload(
      { alt: 'The old photo' },
      await tinyPng(1200, 800),
    )) as unknown as Row
    const after = (await replace(before.id as number, await tinyPng(1600, 900))) as unknown as Row
    expect(after.id).toBe(before.id)
    expect(after.filename).not.toBe(before.filename)
    expect(after.alt).toBe('The old photo')
    const sizes = after.sizes as Record<string, { width?: number | null }>
    expect(sizes.card?.width).toBe(800)
    // The old file is gone from disk with its sizes; the new one serves.
    const media = path.resolve(__dirname, '../../media')
    expect(existsSync(path.join(media, String(before.filename)))).toBe(false)
    expect(existsSync(path.join(media, String(after.filename)))).toBe(true)
  })

  it('a document for a document is marked not checked, whoever had checked the old one', async () => {
    const before = (await upload({ remediationStatus: 'attested' }, tinyPdf())) as unknown as Row
    expect(before.attestedAt).toBeTruthy()
    // The admin form re-sends the old answer; it is reset all the same.
    const after = (await replace(before.id as number, tinyPdf(), {
      remediationStatus: 'attested',
    })) as unknown as Row
    expect(after).toMatchObject({ remediationStatus: 'not-attested', attestedAt: null })
    expect(after.attestedBy ?? null).toBeNull()
  })

  it('a different kind is refused — even with access overridden', async () => {
    const image = (await upload({ alt: 'A photo' }, await tinyPng())) as unknown as Row
    const doc = (await upload({ remediationStatus: 'attested' }, tinyPdf())) as unknown as Row
    for (const [id, file] of [
      [image.id, tinyPdf()],
      [doc.id, await tinyPng()],
    ] as const) {
      expect(await refusal(replace(id as number, file, {}, { overrideAccess: true }))).toContain(
        'Replace an image with an image, or a document with a document.',
      )
    }
  })

  it('an image’s description can’t be emptied in the same breath', async () => {
    const image = (await upload({ alt: 'A photo' }, await tinyPng())) as unknown as Row
    expect(await refusal(replace(image.id as number, await tinyPng(), { alt: '' }))).toContain(
      'Describe the image',
    )
  })

  it('a school replaces its own files with no approval — never another school’s', async () => {
    const mine = (await upload({ alt: 'Ours' }, await tinyPng())) as unknown as Row
    await expect(
      replace(mine.id as number, await tinyPng(), {}, { user: f.managerA }),
    ).resolves.toBeTruthy()
    const theirs = (await upload(
      { tenant: f.tenantB, alt: 'Theirs' },
      await tinyPng(),
    )) as unknown as Row
    await expect(
      replace(theirs.id as number, await tinyPng(), {}, { user: f.managerA }),
    ).rejects.toThrow()
  })

  it('the activity log says “Replaced the file”; the search index follows', async () => {
    const doc = (await upload(
      { title: 'Bus request', remediationStatus: 'attested' },
      tinyPdf(),
    )) as unknown as Row
    const after = (await replace(doc.id as number, tinyPdf())) as unknown as Row
    const { docs: log } = await payload.find({
      collection: 'audit-events',
      where: {
        and: [{ contentType: { equals: 'resources' } }, { documentId: { equals: String(doc.id) } }],
      },
      sort: '-createdAt',
      limit: 1,
      overrideAccess: true,
    })
    expect(log[0]?.summary).toBe(
      `Replaced the file: ${String(doc.filename)} → ${String(after.filename)}`,
    )
    const { docs: entries } = await payload.find({
      collection: 'search',
      where: {
        and: [{ 'doc.relationTo': { equals: 'resources' } }, { 'doc.value': { equals: doc.id } }],
      },
      overrideAccess: true,
    })
    expect((entries[0] as { href?: string } | undefined)?.href).toContain(String(after.filename))
  })
})

describe('the school plane’s folder read (`listMyFolders`)', () => {
  // Locks a regression (2026-11-18): a calendar filter landed on this read too, and every Upload
  // and Replace a file screen failed with "The following path cannot be queried: source".
  it('lists a manager’s own school’s folders, and nothing else', async () => {
    const folder = await payload.create({
      collection: 'resource-folders',
      data: { tenant: f.tenantA, name: 'Menus for the read' } as never,
      overrideAccess: true,
    })
    try {
      const folders = await listMyFolders(await createLocalReq({ user: f.managerA }, payload))
      expect(folders.map((x) => String(x.id))).toContain(String(folder.id))
      expect(folders.every((x) => String(x.tenant) === String(f.tenantA))).toBe(true)
    } finally {
      await payload.delete({ collection: 'resource-folders', id: folder.id, overrideAccess: true })
    }
  })
})
