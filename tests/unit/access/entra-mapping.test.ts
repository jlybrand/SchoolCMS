import { describe, expect, it } from 'vitest'

import { mapEntraGroupsToRoles, type EntraGroupMap } from '@/auth/entra-mapping'

/**
 * Entra group → platform role mapping (`02` §7).
 *
 * This runs on every login and decides what the user can do, so it is tested as a security
 * function rather than as a utility. The governing rule: **the mapping is an allowlist**.
 * An unrecognised group grants nothing; it never falls through to a default role.
 */

const groupMap: EntraGroupMap = {
  'grp-district-admins': 'district-admin',
  'grp-school-managers': 'school-manager',
}

describe('mapEntraGroupsToRoles', () => {
  it('maps a known group to its role', () => {
    expect(mapEntraGroupsToRoles(['grp-district-admins'], groupMap)).toEqual(['district-admin'])
    expect(mapEntraGroupsToRoles(['grp-school-managers'], groupMap)).toEqual(['school-manager'])
  })

  it('maps multiple groups, deduplicated and order-stable', () => {
    expect(
      mapEntraGroupsToRoles(
        ['grp-school-managers', 'grp-district-admins', 'grp-school-managers'],
        groupMap,
      ),
    ).toEqual(['district-admin', 'school-manager'])
  })

  it('IGNORES unmapped groups — allowlist, never fall-through', () => {
    // A district's directory holds hundreds of groups. Anything not explicitly mapped must
    // grant nothing, or adding an unrelated group in Entra becomes a privilege grant here.
    expect(mapEntraGroupsToRoles(['grp-finance', 'grp-everyone'], groupMap)).toEqual([])
    expect(mapEntraGroupsToRoles(['grp-finance', 'grp-district-admins'], groupMap)).toEqual([
      'district-admin',
    ])
  })

  it('grants NOTHING for absent, empty, or malformed claims', () => {
    // A token missing its groups claim must not authenticate into a role. Deny by default
    // is the whole posture (`03` §6).
    expect(mapEntraGroupsToRoles([], groupMap)).toEqual([])
    expect(mapEntraGroupsToRoles(null, groupMap)).toEqual([])
    expect(mapEntraGroupsToRoles(undefined, groupMap)).toEqual([])
    expect(mapEntraGroupsToRoles(['', '   '], groupMap)).toEqual([])
    expect(mapEntraGroupsToRoles([null, 42, {}] as never, groupMap)).toEqual([])
  })

  it('never grants system-sync, whatever the directory says', () => {
    /**
     * `11` §8 — system-sync is a NON-HUMAN actor for the CSI sync, with rights to write the
     * staff directory's CSI fields and nothing else. It must never be reachable by
     * human login, even if someone creates a matching group in Entra by mistake.
     */
    const hostileMap = {
      ...groupMap,
      'grp-sync': 'system-sync',
    } as unknown as EntraGroupMap

    expect(mapEntraGroupsToRoles(['grp-sync'], hostileMap)).toEqual([])
    expect(mapEntraGroupsToRoles(['grp-sync', 'grp-school-managers'], hostileMap)).toEqual([
      'school-manager',
    ])
  })

  it('is exact-match — no case folding, no prefix or substring matching', () => {
    expect(mapEntraGroupsToRoles(['GRP-DISTRICT-ADMINS'], groupMap)).toEqual([])
    expect(mapEntraGroupsToRoles(['grp-district-admins-readonly'], groupMap)).toEqual([])
    expect(mapEntraGroupsToRoles(['x-grp-district-admins'], groupMap)).toEqual([])
  })

  it('grants nothing when the group map itself is empty or absent', () => {
    // A misconfigured deployment must fail closed, not open.
    expect(mapEntraGroupsToRoles(['grp-district-admins'], {})).toEqual([])
    expect(mapEntraGroupsToRoles(['grp-district-admins'], null as never)).toEqual([])
  })
})
