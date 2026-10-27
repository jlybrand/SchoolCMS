import { describe, expect, it } from 'vitest'

import type { AuthUser } from '@/access/types'
import { restoreIsDistrictOnly } from '@/collections/hooks/page-history'

/**
 * The hook that refuses a restore (`beforeOperation`). Payload's `restoreVersion` checks the
 * collection's UPDATE access, which a school manager holds for their own pages — so without
 * this, they could bring back any past version of one as a draft.
 */

const run = (operation: string, user: AuthUser | null, overrideAccess = false) =>
  restoreIsDistrictOnly({ args: { req: { user } }, operation, overrideAccess } as never)

const districtAdmin: AuthUser = { id: 'd1', roles: ['district-admin'] }
const manager: AuthUser = { id: 'm1', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
const sync: AuthUser = { id: 's1', roles: ['system-sync'] }

describe('restoreIsDistrictOnly', () => {
  it('lets a district admin restore', async () => {
    await expect(run('restoreVersion', districtAdmin)).resolves.toBeDefined()
  })

  it.each([
    ['a school manager', manager],
    ['the sync account', sync],
  ])('refuses %s a restore', async (_label, user) => {
    await expect(run('restoreVersion', user)).rejects.toThrow()
  })

  it('refuses an anonymous restore', async () => {
    await expect(run('restoreVersion', null)).rejects.toThrow()
  })

  it('leaves trusted server code alone — the Local API with access overridden', async () => {
    await expect(run('restoreVersion', manager, true)).resolves.toBeDefined()
    await expect(run('restoreVersion', null, true)).resolves.toBeDefined()
  })

  it.each(['create', 'update', 'read', 'delete'])(
    'does nothing to a %s by a school manager',
    async (operation) => {
      await expect(run(operation, manager)).resolves.toBeDefined()
    },
  )
})
