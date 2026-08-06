import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * GUARDRAIL 1 — the content-access layer boundary (`02` §11, ADR-5, `06` §2.8).
 *
 * This suite tests the LINT RULE ITSELF, not the application. A boundary rule that has
 * silently stopped matching is worse than no rule, because the architecture claim it backs
 * ("we could move off Payload if we had to") keeps being made while nothing enforces it.
 *
 * Files are linted as virtual paths via `lintText`, so no deliberately-broken fixture files
 * need to exist on disk where they would themselves trip lint and typecheck.
 */

const eslint = new ESLint()

async function messagesFor(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath })
  return result?.messages ?? []
}

const restricted = (msgs: { ruleId?: string | null }[]) =>
  msgs.filter((m) => m.ruleId === 'no-restricted-imports')

describe('content-access layer boundary', () => {
  describe('is enforced on the public rendering layer', () => {
    const protectedPaths = [
      'src/app/(frontend)/page.tsx',
      'src/app/(frontend)/[locale]/[...slug]/page.tsx',
      'src/components/Header/Header.tsx',
      'src/blocks/Hero/Hero.tsx',
    ]

    it.each(protectedPaths)('rejects a bare `payload` import in %s', async (filePath) => {
      const msgs = await messagesFor(
        `import { getPayload } from 'payload'\nexport default function C() { return null }\n`,
        filePath,
      )
      expect(restricted(msgs)).not.toHaveLength(0)
    })

    it.each(protectedPaths)('rejects an `@payloadcms/*` import in %s', async (filePath) => {
      const msgs = await messagesFor(
        `import { postgresAdapter } from '@payloadcms/db-postgres'\nexport default function C() { return null }\n`,
        filePath,
      )
      expect(restricted(msgs)).not.toHaveLength(0)
    })

    it("rejects consuming Payload's generated types", async () => {
      const msgs = await messagesFor(
        `import type { Page } from '@/payload-types'\nexport type X = Page\n`,
        'src/app/(frontend)/page.tsx',
      )
      expect(restricted(msgs)).not.toHaveLength(0)
    })

    it('allows importing DD2 domain types from the content layer', async () => {
      const msgs = await messagesFor(
        `import type { Tenant } from '@/content'\nexport type X = Tenant\n`,
        'src/app/(frontend)/page.tsx',
      )
      expect(restricted(msgs)).toHaveLength(0)
    })
  })

  describe('exempts the surfaces that must import Payload', () => {
    // Payload 3 mounts its own admin UI and REST/GraphQL handlers as App Router routes.
    // These import @payloadcms/next by construction — see the scope note in eslint.config.mjs.
    it('allows the Payload admin mount point', async () => {
      const msgs = await messagesFor(
        `import { RootPage } from '@payloadcms/next/views'\nexport default RootPage\n`,
        'src/app/(payload)/admin/[[...segments]]/page.tsx',
      )
      expect(restricted(msgs)).toHaveLength(0)
    })

    it('allows the content layer, which owns both sides of the mapping', async () => {
      const msgs = await messagesFor(
        `import { getPayload } from 'payload'\nexport const x = getPayload\n`,
        'src/content/pages.ts',
      )
      expect(restricted(msgs)).toHaveLength(0)
    })

    it('allows collection configs', async () => {
      const msgs = await messagesFor(
        `import type { CollectionConfig } from 'payload'\nexport type X = CollectionConfig\n`,
        'src/collections/Pages.ts',
      )
      expect(restricted(msgs)).toHaveLength(0)
    })
  })
})
