import { describe, expect, it } from 'vitest'

import type { AuthUser } from '@/access/types'
import { restoreIsDistrictOnly } from '@/collections/hooks/page-history'

/**
 * The hook that refuses a restore (`beforeOperation`). Payload's `restoreVersion` checks the
 * collection's UPDATE access, which a school manager holds for their own pages — so without
 * this, they could bring back any past version of one as a draft.
 *
 * And ONLY A VERSION THAT WAS PUBLISHED can be restored (Jason, 2026-10-27), by anyone: a draft
 * that never went live was never approved, so bringing it back would restore content no reviewer
 * passed.
 */

/** A stub payload whose stored versions are `{ id: status }`. */
const payloadWith = (versions: Record<string, string>) => ({
  findVersionByID: async ({ id }: { id: string }) => {
    if (!(id in versions)) throw new Error('Not Found')
    return { id, version: { _status: versions[id] } }
  },
})

const VERSIONS = { 'v-pub': 'published', 'v-draft': 'draft' }

const run = (
  operation: string,
  user: AuthUser | null,
  { overrideAccess = false, id = 'v-pub' } = {},
) =>
  restoreIsDistrictOnly({
    args: { id, req: { user, payload: payloadWith(VERSIONS) } },
    operation,
    overrideAccess,
  } as never)

const districtAdmin: AuthUser = { id: 'd1', roles: ['district-admin'] }
const manager: AuthUser = { id: 'm1', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
const sync: AuthUser = { id: 's1', roles: ['system-sync'] }

describe('restoreIsDistrictOnly', () => {
  it('lets a district admin restore a version that was published', async () => {
    await expect(run('restoreVersion', districtAdmin)).resolves.toBeDefined()
  })

  it('refuses a district admin a version that was only ever a draft, and says why', async () => {
    await expect(run('restoreVersion', districtAdmin, { id: 'v-draft' })).rejects.toThrow(
      'Only a version that was published can be restored.',
    )
  })

  it('refuses a version that does not exist', async () => {
    await expect(run('restoreVersion', districtAdmin, { id: 'v-missing' })).rejects.toThrow()
  })

  it.each([
    ['a school manager', manager],
    ['the sync account', sync],
  ])('refuses %s a restore, even of a published version', async (_label, user) => {
    await expect(run('restoreVersion', user)).rejects.toThrow()
  })

  it('refuses an anonymous restore', async () => {
    await expect(run('restoreVersion', null)).rejects.toThrow()
  })

  it('leaves trusted server code alone — the Local API with access overridden', async () => {
    await expect(
      run('restoreVersion', manager, { overrideAccess: true, id: 'v-draft' }),
    ).resolves.toBeDefined()
    await expect(run('restoreVersion', null, { overrideAccess: true })).resolves.toBeDefined()
  })

  it.each(['create', 'update', 'read', 'delete'])(
    'does nothing to a %s by a school manager',
    async (operation) => {
      await expect(run(operation, manager)).resolves.toBeDefined()
    },
  )
})
