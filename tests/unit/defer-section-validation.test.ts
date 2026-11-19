import type { Config, Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { deferSectionValidation } from '@/lib/defer-section-validation'

/**
 * A page's SECTIONS are checked when it is published or sent for approval, not while it is
 * being written (Jason, 2026-11-19: "when a section is added to a page it immediately shows an
 * error — this should only happen if attempting to publish or send for approval").
 *
 * Payload validates a field in two places: the form's own check as you edit (`event: 'onChange'`)
 * and the server's on a save (`event: 'submit'`). Autosave is a save, tagged `?autosave=true`.
 * Inside a blocks field, both the edit check and an autosave pass; any other save — Publish, Send
 * for approval, the API — is checked in full. Fields outside sections (a page's title) are
 * untouched, so an untitled page still cannot be saved at all.
 */

type Validate = (value: unknown, options: Record<string, unknown>) => unknown

const config = (): Config =>
  ({
    collections: [
      {
        slug: 'pages',
        fields: [
          { name: 'title', type: 'text', required: true },
          {
            name: 'layout',
            type: 'blocks',
            blocks: [
              {
                slug: 'cards',
                fields: [
                  { name: 'heading', type: 'text', required: true },
                  {
                    name: 'cards',
                    type: 'array',
                    fields: [
                      {
                        name: 'title',
                        type: 'text',
                        validate: (v: unknown) => (v ? true : 'A card needs a title.'),
                      },
                    ],
                  },
                  {
                    name: 'columns',
                    type: 'blocks',
                    blocks: [
                      { slug: 'text', fields: [{ name: 'body', type: 'text', required: true }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }) as unknown as Config

const fieldsOf = (c: Config) => c.collections![0]!.fields as unknown as Field[]
const layout = (c: Config) =>
  fieldsOf(c).find((f) => 'name' in f && f.name === 'layout') as unknown as {
    blocks: { fields: (Field & { validate: Validate })[] }[]
  }

const req = (query: Record<string, string> = {}) => ({
  query,
  t: (k: string) => k,
  payload: { config: { defaultMaxTextLength: 40000 } },
})
const opts = (extra: Record<string, unknown>) => ({
  required: true,
  data: {},
  siblingData: {},
  path: [],
  ...extra,
})

describe('deferSectionValidation', () => {
  const out = deferSectionValidation(config())
  const block = layout(out).blocks[0]!
  const heading = block.fields[0]!

  it('as you edit, an empty section field is not an error', async () => {
    expect(await heading.validate('', opts({ event: 'onChange', req: req() }))).toBe(true)
  })

  it('an autosave of an empty section is not refused', async () => {
    expect(
      await heading.validate('', opts({ event: 'submit', req: req({ autosave: 'true' }) })),
    ).toBe(true)
  })

  it('Publish or Send for approval checks it in full — Payload’s own required rule', async () => {
    expect(
      await heading.validate('', opts({ event: 'submit', req: req({ draft: 'true' }) })),
    ).not.toBe(true)
    expect(await heading.validate('Clubs', opts({ event: 'submit', req: req() }))).toBe(true)
  })

  it('a field’s own rule, deep in a section (an array, a nested block), is deferred too', async () => {
    const array = block.fields[1] as unknown as { fields: { validate: Validate }[] }
    const cardTitle = array.fields[0]!
    expect(await cardTitle.validate('', opts({ event: 'onChange', req: req() }))).toBe(true)
    expect(await cardTitle.validate('', opts({ event: 'submit', req: req() }))).toBe(
      'A card needs a title.',
    )
    const nested = block.fields[2] as unknown as {
      blocks: { fields: { validate: Validate }[] }[]
    }
    const body = nested.blocks[0]!.fields[0]!
    expect(await body.validate('', opts({ event: 'onChange', req: req() }))).toBe(true)
    expect(await body.validate('', opts({ event: 'submit', req: req() }))).not.toBe(true)
  })

  it('a field outside the sections is untouched: an untitled page is still refused', () => {
    const title = fieldsOf(out)[0] as unknown as { validate?: Validate }
    expect(title.validate).toBeUndefined()
  })
})
